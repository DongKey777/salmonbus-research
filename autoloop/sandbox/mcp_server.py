#!/usr/bin/env python3
"""Minimal stdio MCP server that gives the AI designer aggregate-only access to the analysis sandbox. Standard library only.

Dual-era per the MCP 2026-07-28 versioning rules: requests that carry _meta["io.modelcontextprotocol/protocolVersion"] are served
statelessly (server/discover, tools/list, tools/call, ping); a legacy client opens with initialize (2025-11-25 and earlier) and is
then served under that revision. The server only validates arguments and dispatches to runner.py, which runs every script in a
network-less container; AI-provided code is never executed on the host. Each call is logged to calls.jsonl with hashes and sizes.
"""
import fcntl
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

SB = Path(__file__).resolve().parent
sys.path.insert(0, str(SB))
import runner  # noqa: E402

NAME, VERSION = 'autoloop-lab', '1.0.0'
MODERN = ['2026-07-28']
LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
PV, CAPS, INFO = 'io.modelcontextprotocol/protocolVersion', 'io.modelcontextprotocol/clientCapabilities', 'io.modelcontextprotocol/clientInfo'
CALLS = SB / 'calls.jsonl'
TEMPLATE = SB / 'templates' / 'slice_errors.py'
MAX_LINE = 256 * 1024
TEXT_CAP = int(os.environ.get('LAB_MCP_TEXT_CAP', 64 * 1024))
MAX_RUNS = int(os.environ.get('LAB_MAX_RUNS', 40))
DEFAULT_TIMEOUT, MAX_TIMEOUT = 180, 600
CATEGORICAL = ['route_code', 'kst_hour', 'service_day', 'horizon_bucket', 'seats_band']
PREDS = ['champion_pred', 'prod_expected_seats']
INSTRUCTIONS = ('Aggregate-only analysis of the DEV_S selection split and a TRAIN sample. Sealed H rows are not available. '
                'Start with describe_data; use slice_errors for templated error tables; use run_analysis for small lab_api scripts. '
                'Cells with fewer than 50 arrival groups are dropped; results are size-capped and row dumps are refused.')


class Bad(ValueError):
    """Invalid tool arguments; reported to the model as a tool execution error."""


def sha(b):
    return hashlib.sha256(b).hexdigest()


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def log(entry):
    entry = {'ts': round(time.time(), 3), 'pid': os.getpid(), **entry}
    line = (json.dumps(entry, sort_keys=True, separators=(',', ':')) + '\n').encode()
    fd = os.open(CALLS, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        os.write(fd, line)
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def manifest():
    return json.loads((runner.DATA / 'MANIFEST.json').read_bytes())


def feature_names():
    names = manifest()['featureNames']
    for n in names:
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,63}', n):
            raise RuntimeError('FEATURE_NAME_FORMAT')
    return names


TOOLS = [
    {'name': 'describe_data', 'title': 'Describe sandbox data',
     'description': 'Schema, row and group counts, derived columns, helper API and limits of the analysis data. Returns no rows.',
     'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False},
     'annotations': {'readOnlyHint': True, 'openWorldHint': False}},
    {'name': 'slice_errors', 'title': 'Templated error slices on DEV_S',
     'description': ('Weighted error table on DEV_S per cell of 1-2 keys. Keys: ' + ', '.join(CATEGORICAL) +
                     ', any feature name (as categories, <=400 distinct), or "<feature>@qK" for K weighted-quantile bins (2..20). '
                     'stat "errors" gives n_rows, n_groups, weight_share, mean_label, mae, bias (pred-label), rmse, mean_pred '
                     '(+ mae_compare, mae_delta with compare); stat "residual_quantiles" gives residual quantiles. '
                     'where filters rows: {"col": value} or {"col": [lo, hi]} (hi exclusive, null open).'),
     'inputSchema': {'type': 'object', 'additionalProperties': False, 'required': ['by'], 'properties': {
         'by': {'type': 'array', 'items': {'type': 'string', 'maxLength': 80}, 'minItems': 1, 'maxItems': 2},
         'pred': {'type': 'string', 'enum': PREDS, 'default': 'champion_pred'},
         'compare': {'type': ['string', 'null'], 'enum': PREDS + [None], 'default': None},
         'stat': {'type': 'string', 'enum': ['errors', 'residual_quantiles'], 'default': 'errors'},
         'min_groups': {'type': 'integer', 'minimum': 50, 'maximum': 100000, 'default': 50},
         'where': {'type': 'object', 'maxProperties': 3}}},
     'annotations': {'readOnlyHint': True, 'openWorldHint': False}},
    {'name': 'run_analysis', 'title': 'Run an analysis script in the sandbox',
     'description': ('Run a Python script (<= 8 KB) in an isolated, network-less container with numpy, pyarrow, scipy, xgboost and '
                     'lab_api. Data is read-only at /data. The script must call lab_api.emit(obj) exactly once with a JSON object '
                     '(<= 256 KB; tool replies above 64 KB are refused). Helpers: lab_api.load(cols, split), groupby_metrics(keys, '
                     'pred_col, split, compare_col, where, min_groups), residual_quantiles(pred_col, keys, qs, split, where), '
                     'correlation_table(cols, split, pred_col, target), summary(cols, split, where), wmae, wbias, describe(). '
                     'split is "dev_s" or "train_sample". pred_col may be a column or a numpy array of the split length. Outputs '
                     'with arrays over 2000 numbers, over 5000 numbers in total, or any n_groups below 50 are refused.'),
     'inputSchema': {'type': 'object', 'additionalProperties': False, 'required': ['script'], 'properties': {
         'script': {'type': 'string', 'maxLength': 8192},
         'timeout_seconds': {'type': 'integer', 'minimum': 10, 'maximum': MAX_TIMEOUT, 'default': DEFAULT_TIMEOUT}}},
     'annotations': {'readOnlyHint': True, 'openWorldHint': False}},
]


def describe_data():
    m = manifest()
    s = m['splits']
    cols = lambda k: [c['name'] + ':' + c['type'] for c in s[k]['columns']]
    return {
        'splits': {
            'dev_s': {'rows': s['dev_s']['rows'], 'groups': s['dev_s']['groups'], 'weightSum': s['dev_s']['weightSum'],
                      'serviceDays': s['dev_s']['serviceDays'], 'columns': cols('dev_s'),
                      'note': 'DEV selection split; the champion and product predictions are available here'},
            'train_sample': {'rows': s['train_sample']['rows'], 'groups': s['train_sample']['groups'],
                             'sampling': s['train_sample']['sampling']['rule'], 'sourceRows': s['train_sample']['sampling']['sourceRows'],
                             'columns': cols('train_sample'), 'note': 'no predictions, service_day or kst_hour'}},
        'featureNames': m['featureNames'], 'label': m['label'], 'weight': m['weight'], 'routeColumn': m['routeColumn'],
        'predictionColumns': m['predictionColumns'],
        'derivedColumns': {'route_code': 'x_route_code as int', 'horizon_bucket': 'f_horizon_stops bucket, edges [1,2,4,8,16,32]',
                           'seats_band': 'f_remaining_seats: 0=NaN 1=0 2=1..5 3=6..20 4=>20', 'residual': 'pred - label', 'abs_error': '|pred - label|'},
        'hExcluded': True,
        'limits': {'scriptBytes': runner.MAX_SCRIPT_BYTES, 'outputBytes': 256 * 1024, 'toolReplyBytes': TEXT_CAP, 'minGroupsPerCell': 50,
                   'maxArrayNumbers': 2000, 'maxNumbersTotal': 5000, 'timeoutSeconds': [10, MAX_TIMEOUT], 'memory': '6 GB', 'cpus': 6,
                   'runsPerSession': MAX_RUNS},
        'example': "import lab_api as L\nr = L.groupby_metrics(['route_code'], compare_col='prod_expected_seats')\nL.emit(r)",
    }


def key_ok(spec, feats):
    m = re.fullmatch(r'([a-z][a-z0-9_]{0,63})(@q([0-9]{1,2}))?', spec)
    if not m or (m.group(1) not in CATEGORICAL and m.group(1) not in feats):
        return False
    return m.group(3) is None or 2 <= int(m.group(3)) <= 20


def slice_args(a):
    if set(a) - {'by', 'pred', 'compare', 'stat', 'min_groups', 'where'}:
        raise Bad('unknown arguments: %s' % sorted(set(a) - {'by', 'pred', 'compare', 'stat', 'min_groups', 'where'}))
    feats = feature_names()
    by = a.get('by')
    if not isinstance(by, list) or not 1 <= len(by) <= 2 or len(set(map(str, by))) != len(by) or not all(isinstance(k, str) and key_ok(k, feats) for k in by):
        raise Bad('by must be 1-2 distinct keys from %s, a feature name, or "<feature>@qK" (K 2..20)' % CATEGORICAL)
    pred = a.get('pred', 'champion_pred')
    compare = a.get('compare')
    if pred not in PREDS or (compare is not None and (compare not in PREDS or compare == pred)):
        raise Bad('pred must be one of %s; compare null or the other one' % PREDS)
    stat = a.get('stat', 'errors')
    if stat not in ('errors', 'residual_quantiles'):
        raise Bad('stat must be "errors" or "residual_quantiles"')
    mg = a.get('min_groups', 50)
    if not isinstance(mg, int) or isinstance(mg, bool) or not 50 <= mg <= 100000:
        raise Bad('min_groups must be an integer in 50..100000')
    where = a.get('where') or {}
    if not isinstance(where, dict) or len(where) > 3:
        raise Bad('where must be an object with at most 3 conditions')
    num = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool) and abs(x) < 1e12 and x == x
    for k, v in where.items():
        if not (isinstance(k, str) and '@' not in k and key_ok(k, feats)):
            raise Bad('where key %r not allowed' % k)
        if not (num(v) or (isinstance(v, list) and len(v) == 2 and all(x is None or num(x) for x in v))):
            raise Bad('where value for %s must be a number or [lo, hi] with numbers or null' % k)
    return {'by': by, 'pred': pred, 'compare': compare, 'stat': stat, 'min_groups': mg, 'where': where}


class Server:
    def __init__(self):
        self.legacy = None
        self.runs = 0

    def send(self, msg):
        sys.stdout.write(json.dumps(msg, separators=(',', ':'), ensure_ascii=False) + '\n')
        sys.stdout.flush()

    def error(self, mid, code, message, data=None):
        e = {'code': code, 'message': message}
        if data is not None:
            e['data'] = data
        self.send({'jsonrpc': '2.0', 'id': mid, 'error': e})

    def result(self, mid, res, modern):
        if modern:
            res = {'resultType': 'complete', **res, '_meta': {'io.modelcontextprotocol/serverInfo': {'name': NAME, 'version': VERSION}}}
        self.send({'jsonrpc': '2.0', 'id': mid, 'result': res})

    def era(self, mid, params):
        """Return (modern, version) or None after sending an error."""
        meta = params.get('_meta') if isinstance(params.get('_meta'), dict) else {}
        if PV in meta:
            v = meta[PV]
            if v not in MODERN:
                self.error(mid, -32022, 'Unsupported protocol version', {'supported': MODERN + LEGACY, 'requested': v})
                return None
            if not isinstance(meta.get(CAPS), dict):
                self.error(mid, -32602, 'Invalid params: _meta["%s"] is required' % CAPS)
                return None
            return True, v
        if self.legacy:
            return False, self.legacy
        self.error(mid, -32602, 'Invalid params: missing _meta["%s"]; legacy clients must send initialize first' % PV,
                   {'supported': MODERN + LEGACY})
        return None

    def handle(self, msg):
        if isinstance(msg, dict) and 'method' not in msg and ('result' in msg or 'error' in msg):
            return
        if not isinstance(msg, dict) or msg.get('jsonrpc') != '2.0' or not isinstance(msg.get('method'), str):
            mid = msg.get('id') if isinstance(msg, dict) and isinstance(msg.get('id'), (str, int)) else None
            return self.error(mid, -32600, 'Invalid Request')
        method = msg['method']
        if 'id' not in msg:
            return
        mid = msg['id']
        if mid is None or isinstance(mid, bool) or not isinstance(mid, (str, int)):
            return self.error(None, -32600, 'Invalid Request: id must be a string or integer')
        params = msg.get('params', {})
        if not isinstance(params, dict):
            return self.error(mid, -32602, 'Invalid params')
        if method == 'initialize':
            v = params.get('protocolVersion')
            self.legacy = v if v in LEGACY else LEGACY[0]
            ci = params.get('clientInfo') if isinstance(params.get('clientInfo'), dict) else {}
            log({'event': 'initialize', 'requested': str(v)[:32], 'negotiated': self.legacy, 'client': str(ci.get('name', ''))[:64], 'clientVersion': str(ci.get('version', ''))[:32]})
            return self.result(mid, {'protocolVersion': self.legacy, 'capabilities': {'tools': {'listChanged': False}},
                                     'serverInfo': {'name': NAME, 'version': VERSION}, 'instructions': INSTRUCTIONS}, False)
        if method not in ('server/discover', 'ping', 'tools/list', 'tools/call'):
            return self.error(mid, -32601, 'Method not found: %s' % method[:64])
        e = self.era(mid, params)
        if e is None:
            return
        modern, version = e
        if method == 'server/discover':
            ci = params['_meta'].get(INFO) if isinstance(params['_meta'].get(INFO), dict) else {}
            log({'event': 'discover', 'protocolVersion': version, 'client': str(ci.get('name', ''))[:64], 'clientVersion': str(ci.get('version', ''))[:32]})
            return self.result(mid, {'supportedVersions': MODERN + LEGACY, 'capabilities': {'tools': {}}, 'instructions': INSTRUCTIONS}, True)
        if method == 'ping':
            return self.result(mid, {}, modern)
        if method == 'tools/list':
            return self.result(mid, {'tools': TOOLS}, modern)
        name = params.get('name')
        args = params.get('arguments', {})
        if name not in {t['name'] for t in TOOLS}:
            return self.error(mid, -32602, 'Unknown tool: %s' % str(name)[:64])
        if not isinstance(args, dict):
            return self.error(mid, -32602, 'Invalid params: arguments must be an object')
        self.result(mid, self.call(name, args, 'modern' if modern else 'legacy', version), modern)

    def call(self, name, args, era, version):
        t0 = time.monotonic()
        entry = {'event': 'tools/call', 'tool': name, 'era': era, 'protocolVersion': version, 'argsSha256': sha(canonical(args))}
        try:
            if name == 'describe_data':
                if args:
                    raise Bad('describe_data takes no arguments')
                payload, is_err = describe_data(), False
                entry['status'] = 'OK'
            else:
                if self.runs >= MAX_RUNS:
                    raise Bad('run budget for this session exhausted (%d)' % MAX_RUNS)
                if name == 'slice_errors':
                    clean = slice_args(args)
                    r = runner.run_script(TEMPLATE.read_text(), timeout=DEFAULT_TIMEOUT, args=clean, kind='slice_errors')
                else:
                    if set(args) - {'script', 'timeout_seconds'}:
                        raise Bad('unknown arguments')
                    script = args.get('script')
                    if not isinstance(script, str):
                        raise Bad('script must be a string')
                    to = args.get('timeout_seconds', DEFAULT_TIMEOUT)
                    if not isinstance(to, int) or isinstance(to, bool) or not 10 <= to <= MAX_TIMEOUT:
                        raise Bad('timeout_seconds must be an integer in 10..%d' % MAX_TIMEOUT)
                    entry['scriptSha256'] = sha(script.encode('utf-8', 'surrogatepass'))
                    entry['scriptBytes'] = len(script.encode('utf-8', 'surrogatepass'))
                    r = runner.run_script(script, timeout=to, kind='run_analysis')
                if r.get('runId'):
                    self.runs += 1
                entry.update({k: r[k] for k in ('status', 'runId', 'resultBytes', 'resultSha256', 'wallSeconds', 'reason') if k in r})
                is_err = r['status'] != 'OK'
                payload = {k: r[k] for k in ('status', 'runId', 'wallSeconds', 'reason', 'logTail', 'result') if k in r}
        except Bad as ex:
            payload, is_err = {'status': 'INVALID_ARGUMENTS', 'reason': str(ex)}, True
            entry['status'] = 'INVALID_ARGUMENTS'
        except Exception as ex:  # infrastructure fault: report the type only
            payload, is_err = {'status': 'SERVER_ERROR', 'reason': type(ex).__name__}, True
            entry['status'] = 'SERVER_ERROR'
            entry['reason'] = type(ex).__name__
        text = json.dumps(payload, separators=(',', ':'), ensure_ascii=False)
        if len(text.encode()) > TEXT_CAP:
            text = json.dumps({'status': 'REPLY_TOO_LARGE', 'reason': 'result is %d bytes; tool replies are capped at %d bytes, emit a smaller summary'
                               % (len(text.encode()), TEXT_CAP), 'runId': payload.get('runId')})
            is_err = True
            entry['status'] = 'REPLY_TOO_LARGE'
        entry['textBytes'] = len(text.encode())
        entry['seconds'] = round(time.monotonic() - t0, 2)
        log(entry)
        return {'content': [{'type': 'text', 'text': text}], 'isError': is_err}

    def serve(self, stdin):
        while True:
            raw = stdin.readline(MAX_LINE + 1)
            if not raw:
                return
            if len(raw) > MAX_LINE and not raw.endswith(b'\n'):
                while raw and not raw.endswith(b'\n'):
                    raw = stdin.readline(MAX_LINE + 1)
                self.error(None, -32600, 'Invalid Request: message larger than %d bytes' % MAX_LINE)
                continue
            line = raw.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                self.error(None, -32700, 'Parse error')
                continue
            if isinstance(msg, list):
                self.error(None, -32600, 'Invalid Request: batches are not supported')
                continue
            self.handle(msg)


if __name__ == '__main__':
    Server().serve(sys.stdin.buffer)
