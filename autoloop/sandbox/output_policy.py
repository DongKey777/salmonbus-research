"""Output policy for sandbox results, shared by the host runner and lab_api inside the container. Standard library only.

A result is one JSON object of at most MAX_BYTES. It is refused when it looks like a row dump: an array holding more than
MAX_ARRAY_NUMBERS numbers, more than MAX_NUMERIC_LEAVES numbers in the whole document (digits inside strings and keys count too),
long or plentiful strings, or any object carrying an ``n_groups`` count below MIN_GROUPS. These are heuristics that bound how much
row-level detail one result can carry; they are not a guarantee against deliberate encoding.
"""
import json
import math
import re

MAX_BYTES = 256 * 1024
MAX_ARRAY_NUMBERS = 2000
MAX_NUMERIC_LEAVES = 5000
MAX_STRING_CHARS = 1000
MAX_TOTAL_STRING_CHARS = 32768
MAX_NODES = 20000
MAX_DEPTH = 24
MIN_GROUPS = 50
_NUM = re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')


class PolicyError(ValueError):
    pass


def _reject_constant(name):
    raise PolicyError('NON_FINITE_NUMBER:' + name)


def parse(raw):
    """Parse result bytes strictly and apply check(); returns the object."""
    if not isinstance(raw, (bytes, bytearray)):
        raise PolicyError('RESULT_NOT_BYTES')
    if len(raw) > MAX_BYTES:
        raise PolicyError('RESULT_TOO_LARGE:%d>%d' % (len(raw), MAX_BYTES))
    try:
        text = bytes(raw).decode('utf-8')
    except UnicodeDecodeError:
        raise PolicyError('RESULT_NOT_UTF8')
    try:
        obj = json.loads(text, parse_constant=_reject_constant)
    except PolicyError:
        raise
    except ValueError as e:
        raise PolicyError('RESULT_NOT_JSON:' + str(e)[:80])
    check(obj)
    return obj


def check(obj):
    if not isinstance(obj, dict):
        raise PolicyError('RESULT_ROOT_NOT_OBJECT')
    st = {'nodes': 0, 'numbers': 0, 'chars': 0}

    def text(s, where):
        if len(s) > MAX_STRING_CHARS:
            raise PolicyError('STRING_TOO_LONG:%s:%d>%d' % (where, len(s), MAX_STRING_CHARS))
        st['chars'] += len(s)
        st['numbers'] += len(_NUM.findall(s))

    def walk(v, depth, path):
        st['nodes'] += 1
        if st['nodes'] > MAX_NODES:
            raise PolicyError('TOO_MANY_NODES:>%d' % MAX_NODES)
        if depth > MAX_DEPTH:
            raise PolicyError('TOO_DEEP:' + path)
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, (int, float)):
            if isinstance(v, float) and not math.isfinite(v):
                raise PolicyError('NON_FINITE_NUMBER:' + path)
            st['numbers'] += 1
            return
        if isinstance(v, str):
            text(v, path)
            return
        if isinstance(v, list):
            n = sum(1 for x in v if isinstance(x, (int, float)) and not isinstance(x, bool))
            if n > MAX_ARRAY_NUMBERS:
                raise PolicyError('ROW_DUMP_ARRAY:%s:%d>%d numbers' % (path, n, MAX_ARRAY_NUMBERS))
            for i, x in enumerate(v):
                walk(x, depth + 1, path + '[%d]' % i)
            return
        if isinstance(v, dict):
            if 'n_groups' in v:
                g = v['n_groups']
                if isinstance(g, bool) or not isinstance(g, int) or g < MIN_GROUPS:
                    raise PolicyError('SMALL_CELL:%s:n_groups=%r<%d' % (path, g, MIN_GROUPS))
            for k, x in v.items():
                if not isinstance(k, str):
                    raise PolicyError('NON_STRING_KEY:' + path)
                text(k, path + '.<key>')
                walk(x, depth + 1, path + '.' + k[:40])
            return
        raise PolicyError('UNSUPPORTED_TYPE:%s:%s' % (path, type(v).__name__))

    walk(obj, 0, '$')
    if st['numbers'] > MAX_NUMERIC_LEAVES:
        raise PolicyError('ROW_DUMP_NUMBERS:%d>%d numeric leaves' % (st['numbers'], MAX_NUMERIC_LEAVES))
    if st['chars'] > MAX_TOTAL_STRING_CHARS:
        raise PolicyError('TOO_MUCH_TEXT:%d>%d chars' % (st['chars'], MAX_TOTAL_STRING_CHARS))
    return st


def dumps(obj):
    """Serialise compactly; refuses NaN/Infinity."""
    return json.dumps(obj, separators=(',', ':'), allow_nan=False, sort_keys=False).encode('utf-8')
