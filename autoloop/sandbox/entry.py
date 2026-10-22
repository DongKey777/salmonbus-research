"""Sandbox entrypoint (PID 1 in the container): runs /job/analysis.py as a child with a wall-clock limit, then relays the single
result file /out/result.json to stdout as one framed line. The host treats everything on stdout as untrusted and re-validates it."""
import base64
import json
import os
import subprocess
import sys

OUT = '/out'
RESULT = 'result.json'
LOG = '/tmp/child.log'
TAIL = 2000
CAP = 256 * 1024


def tail(path):
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            n = f.tell()
            f.seek(max(0, n - TAIL))
            return f.read().decode('utf-8', 'replace')[-TAIL:]
    except OSError:
        return ''


def main():
    timeout = float(os.environ.get('LAB_TIMEOUT', '120'))
    status = 'EXITED'
    with open(LOG, 'wb') as log:
        try:
            p = subprocess.run([sys.executable, '-I', '-B', '/job/analysis.py'], cwd='/tmp', stdin=subprocess.DEVNULL,
                               stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
            code = p.returncode
        except subprocess.TimeoutExpired:
            status, code = 'TIMEOUT', None
    try:
        names = sorted(os.listdir(OUT))
    except OSError:
        names = []
    frame = {'lab_entry': 1, 'status': status, 'exit': code, 'files': names[:20], 'result_b64': None, 'log_tail': None}
    path = os.path.join(OUT, RESULT)
    if names == [RESULT] and os.path.isfile(path) and not os.path.islink(path) and os.path.getsize(path) <= CAP:
        with open(path, 'rb') as f:
            frame['result_b64'] = base64.b64encode(f.read(CAP + 1)).decode('ascii')
    if status != 'EXITED' or code != 0 or frame['result_b64'] is None:
        frame['log_tail'] = tail(LOG)
    sys.stdout.write('LAB_FRAME ' + json.dumps(frame, separators=(',', ':')) + '\n')
    sys.stdout.flush()


if __name__ == '__main__':
    main()
