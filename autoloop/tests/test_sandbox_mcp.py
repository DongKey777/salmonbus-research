"""MCP stdio tests for sandbox/mcp_server.py with a fake client: modern (2026-07-28, per-request _meta) and legacy (initialize)
handshakes, tools/list, tools/call round trips, protocol errors, argument validation, call logging, and that AI-provided code
never runs on the host.

Run: PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider tests/test_sandbox_mcp.py
"""
import hashlib
import json
import os
import queue
import subprocess
import sys
import threading
import unittest
from pathlib import Path

AL = Path(__file__).resolve().parents[1]
SERVER = AL / 'sandbox' / 'mcp_server.py'
CALLS = AL / 'sandbox' / 'calls.jsonl'
META = {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {'name': 'fake-client', 'version': '0'},
        'io.modelcontextprotocol/clientCapabilities': {}}


class Client:
    def __init__(self):
        self.p = subprocess.Popen([sys.executable, '-B', str(SERVER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.q = queue.Queue()
        self.n = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.p.stdout:
            self.q.put(line)

    def send(self, msg):
        self.p.stdin.write(json.dumps(msg).encode() + b'\n')
        self.p.stdin.flush()

    def raw(self, b):
        self.p.stdin.write(b)
        self.p.stdin.flush()

    def recv(self, timeout=300):
        line = self.q.get(timeout=timeout)
        self.assert_one_line(line)
        return json.loads(line)

    @staticmethod
    def assert_one_line(line):
        assert line.endswith(b'\n') and b'\n' not in line[:-1]

    def request(self, method, params=None, meta=True, timeout=300):
        self.n += 1
        params = dict(params or {})
        if meta:
            params['_meta'] = META
        self.send({'jsonrpc': '2.0', 'id': self.n, 'method': method, 'params': params})
        r = self.recv(timeout)
        assert r['id'] == self.n, r
        return r

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=10)


def tool_json(r):
    return json.loads(r['result']['content'][0]['text'])


class Modern(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = Client()

    @classmethod
    def tearDownClass(cls):
        cls.c.close()

    def test_1_discover(self):
        r = self.c.request('server/discover')
        res = r['result']
        self.assertEqual(res['resultType'], 'complete')
        self.assertIn('2026-07-28', res['supportedVersions'])
        self.assertIn('tools', res['capabilities'])
        self.assertEqual(res['_meta']['io.modelcontextprotocol/serverInfo']['name'], 'autoloop-lab')

    def test_2_tools_list(self):
        res = self.c.request('tools/list')['result']
        self.assertEqual([t['name'] for t in res['tools']], ['describe_data', 'slice_errors', 'run_analysis'])
        for t in res['tools']:
            self.assertEqual(t['inputSchema']['type'], 'object')
            self.assertFalse(t['inputSchema']['additionalProperties'])

    def test_3_describe_data(self):
        r = self.c.request('tools/call', {'name': 'describe_data', 'arguments': {}})
        self.assertFalse(r['result']['isError'])
        d = tool_json(r)
        self.assertEqual(d['splits']['dev_s']['rows'], 10701742)
        self.assertEqual(d['splits']['dev_s']['groups'], 170833)
        self.assertTrue(d['hExcluded'])
        self.assertNotIn('hExclusion', json.dumps(d))

    def test_4_slice_errors_round_trip(self):
        r = self.c.request('tools/call', {'name': 'slice_errors', 'arguments': {'by': ['seats_band'], 'compare': 'prod_expected_seats'}})
        self.assertFalse(r['result']['isError'], r)
        d = tool_json(r)
        self.assertEqual(d['status'], 'OK')
        self.assertEqual(d['result']['_lab'], 'groupby/1')
        self.assertTrue(all(c['n_groups'] >= 50 for c in d['result']['cells']))
        self.assertAlmostEqual(d['result']['overall']['mae'], 2.06399, places=4)

    def test_5_slice_errors_validation(self):
        bad = [{'by': ['__import__("os")']}, {'by': []}, {'by': ['route_code'], 'min_groups': 5}, {'by': ['route_code'], 'pred': 'observed_seats'},
               {'by': ['route_code'], 'where': {'sample_id': 3}}, {'by': ['route_code'], 'extra': 1}, {'by': ['f_horizon_stops@q99']}]
        for a in bad:
            r = self.c.request('tools/call', {'name': 'slice_errors', 'arguments': a})
            self.assertTrue(r['result']['isError'], a)
            self.assertEqual(tool_json(r)['status'], 'INVALID_ARGUMENTS', a)

    def test_6_run_analysis_never_runs_on_host(self):
        marker = Path('/tmp') / ('lab-host-marker-%d' % os.getpid())
        script = ("import os, lab_api as L\nopen(%r, 'w').write('x')\nos.system('touch %s.sys')\n"
                  "L.emit({'container_saw_marker': os.path.exists(%r), 'uid': os.getuid()})\n") % (str(marker), str(marker), str(marker))
        r = self.c.request('tools/call', {'name': 'run_analysis', 'arguments': {'script': script, 'timeout_seconds': 60}})
        self.assertFalse(r['result']['isError'], r)
        d = tool_json(r)
        self.assertEqual(d['result'], {'container_saw_marker': True, 'uid': 65534})
        self.assertFalse(marker.exists())
        self.assertFalse(Path(str(marker) + '.sys').exists())
        log = [json.loads(l) for l in CALLS.read_text().splitlines()]
        mine = [e for e in log if e.get('runId') == d['runId']]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]['scriptSha256'], hashlib.sha256(script.encode()).hexdigest())
        self.assertEqual(mine[0]['tool'], 'run_analysis')
        self.assertGreater(mine[0]['resultBytes'], 0)

    def test_7_run_analysis_errors_are_tool_errors(self):
        r = self.c.request('tools/call', {'name': 'run_analysis', 'arguments': {'script': 'x' * 9000}})
        self.assertTrue(r['result']['isError'])
        r = self.c.request('tools/call', {'name': 'run_analysis', 'arguments': {'script': 'raise SystemExit(3)', 'timeout_seconds': 30}})
        self.assertTrue(r['result']['isError'])
        self.assertEqual(tool_json(r)['status'], 'SCRIPT_ERROR')
        r = self.c.request('tools/call', {'name': 'run_analysis', 'arguments': {'script': 'x=1', 'timeout_seconds': 1}})
        self.assertEqual(tool_json(r)['status'], 'INVALID_ARGUMENTS')

    def test_8_protocol_errors(self):
        r = self.c.request('tools/call', {'name': 'no_such_tool', 'arguments': {}})
        self.assertEqual(r['error']['code'], -32602)
        self.c.n += 1
        self.c.send({'jsonrpc': '2.0', 'id': self.c.n, 'method': 'tools/list', 'params': {'_meta': {**META, 'io.modelcontextprotocol/protocolVersion': '1900-01-01'}}})
        r = self.c.recv()
        self.assertEqual(r['error']['code'], -32022)
        self.assertIn('2026-07-28', r['error']['data']['supported'])
        self.assertEqual(r['error']['data']['requested'], '1900-01-01')
        r = self.c.request('tools/list', meta=False)
        self.assertEqual(r['error']['code'], -32602)
        self.c.n += 1
        self.c.send({'jsonrpc': '2.0', 'id': self.c.n, 'method': 'tools/list', 'params': {'_meta': {'io.modelcontextprotocol/protocolVersion': '2026-07-28'}}})
        self.assertEqual(self.c.recv()['error']['code'], -32602)
        r = self.c.request('resources/list')
        self.assertEqual(r['error']['code'], -32601)
        self.c.raw(b'{not json\n')
        self.assertEqual(self.c.recv()['error']['code'], -32700)
        self.c.raw(b'x' * (300 * 1024) + b'\n')
        self.assertEqual(self.c.recv()['error']['code'], -32600)
        self.c.send({'jsonrpc': '2.0', 'method': 'notifications/cancelled', 'params': {'requestId': 1}})
        self.assertEqual(self.c.request('ping')['result']['resultType'], 'complete')


class Legacy(unittest.TestCase):
    def test_initialize_flow(self):
        c = Client()
        try:
            r = c.request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'legacy-client', 'version': '1'}}, meta=False)
            self.assertEqual(r['result']['protocolVersion'], '2025-06-18')
            self.assertEqual(r['result']['serverInfo']['name'], 'autoloop-lab')
            self.assertIn('tools', r['result']['capabilities'])
            c.send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
            r = c.request('tools/list', meta=False)
            self.assertNotIn('resultType', r['result'])
            self.assertEqual(len(r['result']['tools']), 3)
            r = c.request('tools/call', {'name': 'describe_data', 'arguments': {}}, meta=False)
            self.assertEqual(tool_json(r)['splits']['dev_s']['rows'], 10701742)
            self.assertEqual(c.request('ping', meta=False)['result'], {})
            r = c.request('initialize', {'protocolVersion': '2099-01-01', 'capabilities': {}}, meta=False)
            self.assertEqual(r['result']['protocolVersion'], '2025-11-25')
        finally:
            c.close()
        self.assertEqual(c.p.returncode, 0)


if __name__ == '__main__':
    unittest.main()
