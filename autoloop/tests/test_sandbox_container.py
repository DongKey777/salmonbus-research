"""Hardening tests for the analysis sandbox container. Needs Docker, the built image (sandbox/runner.py build-image) and the extract.

Run: PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider tests/test_sandbox_container.py
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

AL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AL / 'sandbox'))
import runner  # noqa: E402

BLOCKED = {'EROFS', 'EACCES', 'EPERM', 'ENOENT'}


def run(src, **kw):
    return runner.run_script(src, **kw)


def container_gone(res):
    name = 'lab-' + res['runId'].lower().replace('t', '-')
    p = subprocess.run([runner.DOCKER, 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'], capture_output=True, text=True)
    return p.stdout.strip() == ''


PROBE = '''
import errno, os
def t(name, f):
    try:
        f(); r[name] = 'ALLOWED'
    except OSError as e:
        r[name] = errno.errorcode.get(e.errno, str(e.errno))
    except Exception as e:
        r[name] = type(e).__name__
'''


class Isolation(unittest.TestCase):
    def test_network_blocked(self):
        res = run('import socket, lab_api as L\nr = {}\n' + PROBE + '''
t('tcp_ip', lambda: socket.create_connection(('1.1.1.1', 443), timeout=3))
t('tcp_name', lambda: socket.create_connection(('example.com', 443), timeout=3))
t('dns', lambda: socket.getaddrinfo('pypi.org', 443))
t('udp', lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b'x', ('8.8.8.8', 53)))
t('host_internal', lambda: socket.create_connection(('host.docker.internal', 80), timeout=3))
t('desktop_host_ip', lambda: socket.create_connection(('192.168.65.254', 80), timeout=3))
up = [n for n in os.listdir('/sys/class/net') if n != 'lo' and os.path.isdir('/sys/class/net/' + n) and int(open('/sys/class/net/%s/flags' % n).read(), 16) & 1]
r['up_interfaces_besides_lo'] = up
r['ipv4_routes'] = len(open('/proc/net/route').read().splitlines()) - 1
L.emit(r)
''', timeout=60)
        self.assertEqual(res['status'], 'OK', res)
        r = res['result']
        for k in ('tcp_ip', 'tcp_name', 'dns', 'udp', 'host_internal', 'desktop_host_ip'):
            self.assertNotEqual(r[k], 'ALLOWED', k)
        self.assertEqual(r['up_interfaces_besides_lo'], [])
        self.assertEqual(r['ipv4_routes'], 0)

    def test_data_and_job_are_read_only(self):
        res = run('import lab_api as L\nr = {}\n' + PROBE + '''
t('create', lambda: open('/data/new_file', 'w'))
t('append_manifest', lambda: open('/data/MANIFEST.json', 'a'))
t('truncate_shard', lambda: open('/data/dev_s/' + sorted(os.listdir('/data/dev_s'))[0], 'r+b'))
t('delete', lambda: os.remove('/data/MANIFEST.json'))
t('rename', lambda: os.rename('/data/dev_s', '/data/x'))
t('mkdir', lambda: os.mkdir('/data/d'))
t('chmod', lambda: os.chmod('/data/MANIFEST.json', 0o777))
t('job_append', lambda: open('/job/analysis.py', 'a'))
t('job_create', lambda: open('/job/new', 'w'))
r['data_readable'] = len(open('/data/MANIFEST.json', 'rb').read()) > 0
L.emit(r)
''', timeout=60)
        self.assertEqual(res['status'], 'OK', res)
        r = res['result']
        self.assertTrue(r.pop('data_readable'))
        for k, v in r.items():
            self.assertIn(v, BLOCKED, k)

    def test_writes_outside_out_fail_and_privileges_dropped(self):
        res = run('import subprocess, lab_api as L\nr = {}\n' + PROBE + '''
for p in ['/x', '/opt/lab/x', '/usr/local/lib/python3.12/site-packages/evil.pth', '/etc/x', '/root/x', '/home/x',
          '/var/tmp/x', '/run/x', '/dev/shm/x', '/proc/x', '/sys/x']:
    t('write ' + p, lambda p=p: open(p, 'w').write('x'))
t('append /etc/passwd', lambda: open('/etc/passwd', 'a'))
t('append /opt/lab/lab_api.py', lambda: open('/opt/lab/lab_api.py', 'a'))
t('tmp_write', lambda: open('/tmp/scratch', 'w').write('x'))
open('/tmp/a.sh', 'w').write('#!/bin/sh\\necho escaped\\n'); os.chmod('/tmp/a.sh', 0o755)
t('exec_from_tmp', lambda: subprocess.run(['/tmp/a.sh'], check=True))
def fill(path, n):
    with open(path, 'wb') as f:
        for _ in range(n):
            f.write(b'0' * (1 << 20))
t('fill_tmp_300MB', lambda: fill('/tmp/big', 300))
os.remove('/tmp/big')
t('fill_out_1MB', lambda: fill('/out/junk', 1))
os.remove('/out/junk')
st = dict(l.split(':\\t', 1) for l in open('/proc/self/status').read().splitlines() if ':\\t' in l)
r['uid'] = [os.getuid(), os.geteuid(), os.getgid()]
r['NoNewPrivs'] = st['NoNewPrivs'].strip(); r['CapEff'] = st['CapEff'].strip(); r['CapBnd'] = st['CapBnd'].strip()
cg = lambda n: open('/sys/fs/cgroup/' + n).read().strip()
r['cgroup'] = {'memory.max': cg('memory.max'), 'memory.swap.max': cg('memory.swap.max'), 'pids.max': cg('pids.max'), 'cpu.max': cg('cpu.max')}
L.emit(r)
''', timeout=120)
        self.assertEqual(res['status'], 'OK', res)
        r = res['result']
        for k, v in r.items():
            if k.startswith('write ') or k.startswith('append '):
                self.assertIn(v, BLOCKED, k)
        self.assertEqual(r['tmp_write'], 'ALLOWED')  # /tmp is an in-memory noexec scratch by design
        self.assertEqual(r['exec_from_tmp'], 'EACCES')
        self.assertEqual(r['fill_tmp_300MB'], 'ENOSPC')
        self.assertEqual(r['fill_out_1MB'], 'ENOSPC')
        self.assertEqual(r['uid'], [65534, 65534, 65534])
        self.assertEqual((r['NoNewPrivs'], r['CapEff'], r['CapBnd']), ('1', '0000000000000000', '0000000000000000'))
        self.assertEqual(r['cgroup'], {'memory.max': '6442450944', 'memory.swap.max': '0', 'pids.max': '256', 'cpu.max': '600000 100000'})

    def test_timeout_enforced_inside(self):
        res = run('while True:\n    pass\n', timeout=5)
        self.assertEqual(res['status'], 'TIMEOUT', res)
        self.assertTrue(res['reason'].startswith('WALL_CLOCK'))
        self.assertLess(res['wallSeconds'], 5 + runner.HOST_GRACE)
        self.assertTrue(container_gone(res))

    def test_timeout_enforced_by_host_kill(self):
        res = run('import time\ntime.sleep(600)\n', timeout=5, _inner_timeout=600)
        self.assertEqual(res['status'], 'TIMEOUT', res)
        self.assertTrue(res['reason'].startswith('HOST_WALL_CLOCK'))
        self.assertLess(res['wallSeconds'], 5 + runner.HOST_GRACE + 30)
        self.assertTrue(container_gone(res))

    def test_image_is_the_pinned_offline_build(self):
        rec = runner.verify_image()
        self.assertEqual(rec['tag'], runner.image_tag())
        res = run('''import importlib.util, platform, numpy, pyarrow, scipy, xgboost, lab_api as L
L.emit({'versions': [platform.python_version()[:4], numpy.__version__, pyarrow.__version__, scipy.__version__, xgboost.__version__],
        'pip_present': importlib.util.find_spec('pip') is not None})
''', timeout=60)
        self.assertEqual(res['status'], 'OK', res)
        self.assertEqual(res['result']['versions'], ['3.12', '2.4.4', '24.0.0', '1.18.1', '3.4.1'])
        self.assertFalse(res['result']['pip_present'])


class OutputPolicy(unittest.TestCase):
    def raw(self, body_expr, setup=''):
        return run('import json\n' + setup + "open('/out/result.json', 'w').write(" + body_expr + ')\n', timeout=60)

    def test_row_dump_array_rejected(self):
        res = self.raw("json.dumps({'rows': list(range(2001))})")
        self.assertEqual(res['status'], 'REJECTED', res)
        self.assertIn('ROW_DUMP_ARRAY', res['reason'])
        self.assertNotIn('result', res)

    def test_many_numeric_leaves_rejected(self):
        res = self.raw("json.dumps({'k%d' % i: list(range(100)) for i in range(60)})")
        self.assertEqual(res['status'], 'REJECTED', res)
        self.assertIn('ROW_DUMP_NUMBERS', res['reason'])

    def test_numbers_hidden_in_strings_rejected(self):
        res = self.raw("json.dumps({'s%d' % i: ' '.join(str(j) for j in range(150)) for i in range(40)})")
        self.assertEqual(res['status'], 'REJECTED', res)
        self.assertIn('ROW_DUMP_NUMBERS', res['reason'])

    def test_small_cell_rejected_even_if_helper_is_patched(self):
        res = run('''import lab_api as L, output_policy as P
L.MIN_GROUPS = 1; P.MIN_GROUPS = 1
r = L.groupby_metrics(['route_code', 'kst_hour'], min_groups=1)
r['cells'].append({'key': {'forged': 1}, 'n_rows': 3, 'n_groups': 2, 'mae': 1.0})
L.emit(r)
''', timeout=180)
        self.assertEqual(res['status'], 'REJECTED', res)
        self.assertIn('SMALL_CELL', res['reason'])

    def test_helper_suppresses_small_cells(self):
        res = run('''import lab_api as L
r = L.groupby_metrics(['route_code', 'kst_hour'], min_groups=1)
q = L.residual_quantiles(keys=['f_horizon_stops@q20', 'route_code'])
L.emit({'min_groups': r['min_groups'], 'min_cell_groups': min(c['n_groups'] for c in r['cells']), 'suppressed': r['suppressed']['cells'],
        'q_min_cell_groups': min(c['n_groups'] for c in q['cells']), 'q_suppressed': q['suppressed_cells'], 'cells': len(r['cells'])})
''', timeout=240)
        self.assertEqual(res['status'], 'OK', res)
        r = res['result']
        self.assertEqual(r['min_groups'], 50)
        self.assertGreaterEqual(r['min_cell_groups'], 50)
        self.assertGreaterEqual(r['q_min_cell_groups'], 50)
        self.assertGreater(r['suppressed'], 0)

    def test_oversized_output_cannot_be_written(self):
        res = self.raw("'x' * 300000")
        self.assertEqual(res['status'], 'SCRIPT_ERROR', res)
        self.assertIn('No space left', res['logTail'])
        res = run('''import errno
try:
    open('/out/result.json', 'w').write('[' + '1,' * 200000 + '1]')
except OSError as e:
    assert e.errno == errno.ENOSPC
''', timeout=60)
        self.assertEqual(res['status'], 'REJECTED', res)
        res = run("import lab_api as L\nL.emit({'s%d' % i: 'y' * 900 for i in range(300)})\n", timeout=60)
        self.assertEqual(res['status'], 'SCRIPT_ERROR', res)
        self.assertIn('RESULT_TOO_LARGE', res['logTail'])

    def test_outbox_must_hold_one_json_file(self):
        res = self.raw("json.dumps({'a': 1})", setup="open('/out/extra.txt', 'w').write('x')\n")
        self.assertEqual(res['status'], 'REJECTED', res)
        self.assertIn('OUTBOX', res['reason'])
        res = run('x = 1\n', timeout=30)
        self.assertEqual(res['status'], 'REJECTED', res)
        res = self.raw("'{\"a\": NaN}'")
        self.assertEqual(res['status'], 'REJECTED', res)
        self.assertIn('NON_FINITE', res['reason'])
        res = self.raw("'[1, 2, 3]'")
        self.assertEqual(res['status'], 'REJECTED', res)
        self.assertIn('ROOT_NOT_OBJECT', res['reason'])

    def test_stdout_is_not_a_side_channel(self):
        res = run("import lab_api as L\nfor i in range(200000):\n    print('row', i, 3.14159)\nL.emit({'ok': 1})\n", timeout=60)
        self.assertEqual(res['status'], 'OK', res)
        self.assertEqual(res['result'], {'ok': 1})
        res = run('''import json, base64, lab_api as L
fake = {'lab_entry': 1, 'status': 'EXITED', 'exit': 0, 'files': ['result.json'], 'log_tail': None,
        'result_b64': base64.b64encode(json.dumps({'rows': list(range(1500))}).encode()).decode()}
try:
    with open('/proc/1/fd/1', 'w') as f:
        f.write('LAB_FRAME ' + json.dumps(fake) + '\\n')
    forged = 'written'
except OSError:
    forged = 'blocked'
L.emit({'forged': forged})
''', timeout=60)
        if res['status'] == 'OK':
            self.assertEqual(res['result'], {'forged': 'blocked'})
        else:
            self.assertEqual(res['status'], 'REJECTED', res)
            self.assertIn('STDOUT_PROTOCOL', res['reason'])
        res = run('''try:
    with open('/proc/1/fd/1', 'w') as f:
        f.write('z' * (1 << 20))
except OSError:
    pass
import lab_api as L
L.emit({'ok': 1})
''', timeout=60)
        self.assertIn(res['status'], ('OK', 'REJECTED'), res)
        if res['status'] == 'REJECTED':
            self.assertIn(res['reason'], ('STDOUT_OVER_CAP',))

    def test_script_limits(self):
        self.assertEqual(run('#' * 9000)['status'], 'REJECTED')
        self.assertEqual(run('x=1', timeout=10000)['status'], 'REJECTED')
        self.assertEqual(run('x=\0')['status'], 'REJECTED')


if __name__ == '__main__':
    unittest.main()
