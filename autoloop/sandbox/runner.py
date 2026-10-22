#!/usr/bin/env python3
"""Host-side launcher for sandbox analysis scripts. Standard library only; never executes a script on the host.

Each script runs in its own container: no network, read-only root, all capabilities dropped, no-new-privileges, uid 65534,
256 pids, 6 GB memory without swap, 6 CPUs, noexec tmpfs /tmp, the extract read-only at /data, the script read-only at /job.
The outbox /out is a 256 KiB tmpfs, so a script cannot grow the host disk; the entrypoint relays the single result file over the
attached stdout (no log driver), which the host reads with a byte cap and re-validates with output_policy before it writes the
result into a fresh host outbox runs/<id>/out/result.json. A wall-clock limit is enforced inside (entrypoint) and outside
(docker kill). Runs are serialised by a lock file.

CLI: runner.py build-image | verify | run SCRIPT.py [--timeout S]
"""
import argparse
import base64
import fcntl
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

SB = Path(__file__).resolve().parent
AL = SB.parent
DATA = AL / 'sandbox-data'
RUNS = SB / 'runs'
IMAGE_FILE = SB / 'IMAGE.json'
WHEELS = AL.parent / 'ml-research' / 'route-balance-impl-v1' / '.wheels-linux-aarch64'
DEBS = AL.parent / 'ml-research' / 'route-balance-impl-v1' / '.debs-linux-aarch64'
IMAGE_INPUTS = ['Dockerfile', '.dockerignore', 'requirements.lock', 'output_policy.py', 'lab_api.py', 'entry.py']
DOCKER = shutil.which('docker') or '/usr/local/bin/docker'
MAX_SCRIPT_BYTES = 8192
MAX_TIMEOUT = 900
DEFAULT_TIMEOUT = 180
HOST_GRACE = 20
STDOUT_CAP = 512 * 1024
STDERR_CAP = 16 * 1024
KEEP_RUNS = 200
LOCK_WAIT = 1200

sys.path.insert(0, str(SB))
import output_policy as P  # noqa: E402


class InfraError(RuntimeError):
    pass


def sha_bytes(b):
    return hashlib.sha256(b).hexdigest()


def file_sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(8 << 20), b''):
            h.update(b)
    return h.hexdigest()


def image_inputs_sha():
    h = hashlib.sha256()
    for n in IMAGE_INPUTS:
        b = (SB / n).read_bytes()
        h.update(n.encode() + b'\0' + str(len(b)).encode() + b'\0' + b)
    return h.hexdigest()


def image_tag():
    return 'autoloop-sandbox:' + image_inputs_sha()[:16]


def docker(*args, timeout=120, check=True):
    p = subprocess.run([DOCKER, *args], capture_output=True, timeout=timeout)
    if check and p.returncode != 0:
        raise InfraError('DOCKER_FAILED:%s:%s' % (args[0], p.stderr.decode('utf-8', 'replace')[-400:]))
    return p


def build_image():
    tag = image_tag()
    cmd = [DOCKER, 'build', '--network', 'none', '--pull=false', '--provenance=false', '--sbom=false', '--progress', 'plain', '-f', str(SB / 'Dockerfile'),
           '--build-context', 'wheels=' + str(WHEELS), '--build-context', 'debs=' + str(DEBS), '-t', tag, str(SB)]
    p = subprocess.run(cmd, capture_output=True, timeout=1800)
    log = (p.stdout + p.stderr).decode('utf-8', 'replace')
    if p.returncode != 0:
        raise InfraError('IMAGE_BUILD_FAILED:' + log[-2000:])
    info = json.loads(docker('image', 'inspect', tag).stdout)[0]
    rec = {'schema': 'AUTOLOOP_SANDBOX_IMAGE/1', 'tag': tag, 'imageId': info['Id'], 'inputsSha256': image_inputs_sha(),
           'inputs': {n: file_sha(SB / n) for n in IMAGE_INPUTS}, 'wheels': {w.name: file_sha(w) for w in sorted(WHEELS.glob('*.whl'))},
           'base': 'python:3.12-slim@sha256:cb33f7f771ecec2ef1225cf39b159591a040391bd73e4c01f00fdfc4c47611d2',
           'sizeBytes': info.get('Size'), 'builtAtEpoch': int(time.time())}
    tmp = IMAGE_FILE.with_suffix('.json.next')
    tmp.write_text(json.dumps(rec, indent=1, sort_keys=True) + '\n')
    tmp.rename(IMAGE_FILE)
    return rec, log


def verify_image():
    if not IMAGE_FILE.exists():
        raise InfraError('IMAGE_NOT_BUILT')
    rec = json.loads(IMAGE_FILE.read_bytes())
    if rec['inputsSha256'] != image_inputs_sha() or rec['tag'] != image_tag():
        raise InfraError('IMAGE_STALE:sandbox files changed since the image was built')
    p = docker('image', 'inspect', '--format', '{{.Id}}', rec['tag'], check=False)
    if p.returncode != 0 or p.stdout.decode().strip() != rec['imageId']:
        raise InfraError('IMAGE_ID_MISMATCH')
    return rec


def verify_data(full=False):
    """The mount must hold exactly the manifest's files (plus MANIFEST.json) with the recorded sizes (and digests when full)."""
    mp = DATA / 'MANIFEST.json'
    if not mp.is_file():
        raise InfraError('DATA_NOT_BUILT')
    m = json.loads(mp.read_bytes())
    if m.get('schema') != 'AUTOLOOP_SANDBOX_DATA/1':
        raise InfraError('DATA_SCHEMA')
    h = m['hExclusion']
    if not (h['devSSampleIdsInH'] == 0 and h['devSGroupsInH'] == 0 and h['trainSampleGroupsInH'] == 0 and h['trainGroupsInDev'] == 0 and h['devPartition'] is True):
        raise InfraError('DATA_H_PROOF')
    want = {f['path']: f for s in m['splits'].values() for f in s['files']}
    have = set()
    for root, dirs, files in os.walk(DATA):
        for d in dirs:
            if (Path(root) / d).is_symlink():
                raise InfraError('DATA_SYMLINK')
        for f in files:
            have.add(str((Path(root) / f).relative_to(DATA)))
    if have != set(want) | {'MANIFEST.json'}:
        raise InfraError('DATA_FILE_SET:%d unexpected, %d missing' % (len(have - set(want) - {'MANIFEST.json'}), len(set(want) - have)))
    for rel, f in want.items():
        p = DATA / rel
        if p.is_symlink() or p.stat().st_size != f['bytes']:
            raise InfraError('DATA_FILE_SIZE:' + rel)
        if full and file_sha(p) != f['sha256']:
            raise InfraError('DATA_FILE_SHA:' + rel)
    return m


def docker_run_cmd(name, job, image, timeout):
    return [DOCKER, 'run', '--rm', '--name', name, '--pull', 'never',
            '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--user', '65534:65534', '--pids-limit', '256', '--memory', '6g', '--memory-swap', '6g', '--cpus', '6',
            '--ulimit', 'core=0', '--ulimit', 'nofile=1024:1024', '--log-driver', 'none', '--ipc', 'none', '--hostname', 'lab',
            '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=256m',
            '--tmpfs', '/out:rw,noexec,nosuid,nodev,size=256k,uid=65534,gid=65534,mode=0700',
            '-v', '%s:/data:ro' % DATA, '-v', '%s:/job:ro' % job,
            '-e', 'LAB_TIMEOUT=%d' % timeout, '-e', 'HOME=/tmp', '-e', 'OMP_NUM_THREADS=6', '-e', 'OPENBLAS_NUM_THREADS=6',
            image, 'python', '-I', '-B', '/opt/lab/entry.py']


def _reader(stream, cap, sink, over):
    n = 0
    while True:
        b = stream.read(65536)
        if not b:
            break
        n += len(b)
        if n > cap:
            over.set()
            continue
        sink.append(b)


def _prune():
    runs = sorted((p for p in RUNS.iterdir() if p.is_dir() and re.fullmatch(r'\d{8}T\d{6}-[0-9a-f]{8}', p.name)), key=lambda p: p.name)
    for p in runs[:-KEEP_RUNS]:
        shutil.rmtree(p, ignore_errors=True)


def run_script(script, timeout=DEFAULT_TIMEOUT, args=None, kind='run_analysis', _inner_timeout=None):
    """Run one analysis script in a fresh container and return a status dict; never raises for script faults."""
    t0 = time.monotonic()
    raw = script.encode('utf-8') if isinstance(script, str) else None
    if raw is None or len(raw) > MAX_SCRIPT_BYTES or b'\0' in raw:
        return {'status': 'REJECTED', 'reason': 'SCRIPT_INVALID:must be text of at most %d bytes without NUL' % MAX_SCRIPT_BYTES}
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 5 <= timeout <= MAX_TIMEOUT:
        return {'status': 'REJECTED', 'reason': 'TIMEOUT_INVALID:integer seconds in 5..%d' % MAX_TIMEOUT}
    res = {'kind': kind, 'scriptSha256': sha_bytes(raw), 'scriptBytes': len(raw)}
    try:
        image = verify_image()['tag']
        verify_data(full=False)
    except InfraError as e:
        return {**res, 'status': 'INFRA_ERROR', 'reason': str(e)[:300]}
    RUNS.mkdir(exist_ok=True)
    lockf = open(RUNS / '.lock', 'a+')
    waited = time.monotonic()
    while True:
        try:
            fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() - waited > LOCK_WAIT:
                lockf.close()
                return {**res, 'status': 'INFRA_ERROR', 'reason': 'SANDBOX_BUSY'}
            time.sleep(0.5)
    try:
        _prune()
        rid = time.strftime('%Y%m%dT%H%M%S') + '-' + secrets.token_hex(4)
        rd = RUNS / rid
        job = rd / 'job'
        job.mkdir(parents=True)
        os.chmod(rd, 0o755)
        os.chmod(job, 0o755)
        (job / 'analysis.py').write_bytes(raw)
        if args is not None:
            (job / 'args.json').write_bytes(P.dumps(args))
        for f in job.iterdir():
            os.chmod(f, 0o644)
        name = 'lab-' + rid.lower().replace('t', '-')
        res['runId'] = rid
        cmd = docker_run_cmd(name, job, image, _inner_timeout or timeout)
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, err, over = [], [], threading.Event()
        th = [threading.Thread(target=_reader, args=(proc.stdout, STDOUT_CAP, out, over), daemon=True),
              threading.Thread(target=_reader, args=(proc.stderr, STDERR_CAP, err, threading.Event()), daemon=True)]
        for t in th:
            t.start()
        deadline = time.monotonic() + timeout + HOST_GRACE
        killed = None
        while proc.poll() is None:
            if over.is_set():
                killed = 'STDOUT_CAP'
            elif time.monotonic() > deadline:
                killed = 'HOST_TIMEOUT'
            if killed:
                docker('kill', name, check=False, timeout=30)
                try:
                    proc.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    proc.kill()
                break
            time.sleep(0.1)
        for t in th:
            t.join(timeout=10)
        docker('rm', '-f', name, check=False, timeout=30)
        res['wallSeconds'] = round(time.monotonic() - t0, 2)
        res['dockerExit'] = proc.returncode
        if killed == 'HOST_TIMEOUT':
            return _finish(rd, {**res, 'status': 'TIMEOUT', 'reason': 'HOST_WALL_CLOCK:%ds' % timeout})
        if killed == 'STDOUT_CAP' or over.is_set():
            return _finish(rd, {**res, 'status': 'REJECTED', 'reason': 'STDOUT_OVER_CAP'})
        stdout = b''.join(out)
        lines = stdout.split(b'\n')
        if lines and lines[-1] == b'':
            lines.pop()
        if len(lines) != 1 or not lines[0].startswith(b'LAB_FRAME '):
            tail = b''.join(err).decode('utf-8', 'replace')[-300:]
            return _finish(rd, {**res, 'status': 'INFRA_ERROR' if not stdout else 'REJECTED',
                                'reason': ('NO_FRAME:' + tail) if not stdout else 'STDOUT_PROTOCOL:%d lines' % len(lines)})
        try:
            frame = json.loads(lines[0][len('LAB_FRAME '):])
            assert isinstance(frame, dict)
        except (ValueError, AssertionError):
            return _finish(rd, {**res, 'status': 'REJECTED', 'reason': 'FRAME_NOT_JSON'})
        log_tail = frame.get('log_tail')
        log_tail = log_tail[-2000:] if isinstance(log_tail, str) else None
        if frame.get('status') == 'TIMEOUT':
            return _finish(rd, {**res, 'status': 'TIMEOUT', 'reason': 'WALL_CLOCK:%ds' % (_inner_timeout or timeout), 'logTail': log_tail})
        files = frame.get('files')
        if frame.get('exit') != 0:
            return _finish(rd, {**res, 'status': 'SCRIPT_ERROR', 'reason': 'EXIT:%s' % frame.get('exit'), 'logTail': log_tail})
        if files != ['result.json'] or not isinstance(frame.get('result_b64'), str):
            return _finish(rd, {**res, 'status': 'REJECTED', 'reason': 'OUTBOX_MUST_HOLD_ONLY_result.json:%s' % (files if isinstance(files, list) else '?'), 'logTail': log_tail})
        try:
            body = base64.b64decode(frame['result_b64'], validate=True)
            obj = P.parse(body)
        except P.PolicyError as e:
            return _finish(rd, {**res, 'status': 'REJECTED', 'reason': 'POLICY:' + str(e)[:300]})
        except ValueError:
            return _finish(rd, {**res, 'status': 'REJECTED', 'reason': 'FRAME_BASE64'})
        outbox = rd / 'out'
        outbox.mkdir()
        (outbox / 'result.json').write_bytes(body)
        return _finish(rd, {**res, 'status': 'OK', 'result': obj, 'resultBytes': len(body), 'resultSha256': sha_bytes(body)})
    finally:
        fcntl.flock(lockf, fcntl.LOCK_UN)
        lockf.close()


def _finish(rd, res):
    rec = {k: v for k, v in res.items() if k not in ('result', 'logTail')}
    rec['finishedAtEpoch'] = int(time.time())
    (rd / 'receipt.json').write_text(json.dumps(rec, sort_keys=True) + '\n')
    return res


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('build-image')
    v = sub.add_parser('verify')
    v.add_argument('--full', action='store_true')
    r = sub.add_parser('run')
    r.add_argument('script')
    r.add_argument('--timeout', type=int, default=DEFAULT_TIMEOUT)
    a = ap.parse_args()
    if a.cmd == 'build-image':
        rec, log = build_image()
        print(log[-3000:])
        print(json.dumps(rec, indent=1))
    elif a.cmd == 'verify':
        rec = verify_image()
        m = verify_data(full=a.full)
        print(json.dumps({'image': rec['tag'], 'imageId': rec['imageId'], 'dataFiles': sum(len(s['files']) for s in m['splits'].values()), 'full': a.full}))
    else:
        res = run_script(Path(a.script).read_text(), timeout=a.timeout)
        print(json.dumps(res, indent=1)[:20000])


if __name__ == '__main__':
    main()
