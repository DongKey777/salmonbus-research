#!/usr/bin/env python3
"""Copy a whitelist of loop code, site source and research docs into this repo, then run the public-data audit.

usage: python3 scripts/export.py [--dry-run] [--no-audit]
Source locations come from .export.env (untracked) so no machine path is committed:
  AL_SRC=<autoloop dir>  SITE_SRC=<monitor-web dir>  LOOP_PLAN=<LOOP-PLAN-*.md>  AUDIT_PRIVATE_ROOT=<private dir>
Only whitelisted files are copied; everything else (state, ledgers, runs, outputs, data, models, logs) stays behind.
Files that disappeared from the source are removed from the managed folders (autoloop/, site/, research/).
"""
import fnmatch, os, shutil, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAX_BYTES = 512 * 1024
SKIP_DIRS = {'__pycache__', 'node_modules', '.venv', '.git', 'credentials', 'runs', 'outputs', 'sandbox-data',
             'dist', 'dist-pages', 'snapshots', 'evidence', '.playwright-cli', 'output'}
DATA_EXT = {'.npy', '.parquet', '.ubj', '.pkl', '.joblib', '.bin', '.onnx', '.pt', '.xgb', '.model', '.jsonl', '.out', '.log', '.stdout', '.stderr', '.tgz', '.zip'}
SENSITIVE_NAME = ('key', 'secret', 'credential', 'token', 'password')

# (managed folder, source env[/subdir], include globs relative to the source, extra exclude globs)
RULES = [
    ('autoloop', 'AL_SRC',
     ['*.py', '*.sh', '**/*.py', '**/*.sh', 'policy.json', 'planner/feature_catalog.json', 'planner/initial_ideas.json',
      'tests/spec-*.json', 'tests/fixtures_judge/*.json', 'tests-next/spec-*.json', 'tests-next/derived-artifacts/derived-*.parity.json',
      'sandbox/Dockerfile', 'sandbox/.dockerignore', 'sandbox/requirements.lock'],
     ['tests*/root-*/**', 'tests*/hfinal-out/**', 'hfinal/runs/**', 'sandbox/runs/**', 'ai/outputs/**', 'research/**',
      'state.json', 'ledger.jsonl', 'ai/calls.jsonl*', 'incidents.json']),
    ('site', 'SITE_SRC',
     ['src/**', 'test/**', 'scripts/**', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
      'public/autoloop-route.html', 'public/*.schema.json', 'README.md'],
     ['scripts/.*', '**/.*', 'src/cycles/schema-source.json']),
    ('research', 'AL_SRC/research', ['*.md'], []),
]


def load_env():
    env_file = REPO / '.export.env'
    if not env_file.exists():
        sys.exit('missing .export.env (AL_SRC, SITE_SRC, LOOP_PLAN, AUDIT_PRIVATE_ROOT)')
    env = {}
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = os.path.expanduser(v.strip())
    return env


def match(rel, globs):
    return any(fnmatch.fnmatchcase(rel, g) or (g.startswith('**/') and fnmatch.fnmatchcase(rel, g[3:])) for g in globs)


def candidates(src, include, exclude, skipped):
    for root, dirs, files in os.walk(src, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not (Path(root, d).is_symlink()))
        for name in sorted(files):
            p = Path(root, name)
            rel = p.relative_to(src).as_posix()
            if not match(rel, include) or match(rel, exclude):
                continue
            low = name.lower()
            if p.is_symlink():
                skipped.append((rel, 'symlink')); continue
            if p.suffix.lower() in DATA_EXT:
                skipped.append((rel, 'data or log file')); continue
            if any(s in low for s in SENSITIVE_NAME):
                skipped.append((rel, 'key-related name')); continue
            if p.stat().st_size > MAX_BYTES:
                skipped.append((rel, 'over 512 KB')); continue
            yield rel, p


def main():
    dry = '--dry-run' in sys.argv
    env = load_env()
    plan, skipped = {}, []
    for folder, key, include, exclude in RULES:
        k, _, sub = key.partition('/')
        src = Path(env[k]) / sub
        for rel, p in candidates(src, include, exclude, skipped):
            plan[f'{folder}/{rel}'] = p
    plan['research/' + Path(env['LOOP_PLAN']).name] = Path(env['LOOP_PLAN'])
    managed = ['autoloop', 'site', 'research']
    stale = [p for m in managed if (REPO / m).exists() for p in (REPO / m).rglob('*') if p.is_file() and p.relative_to(REPO).as_posix() not in plan]
    total = sum(p.stat().st_size for p in plan.values())
    by_top = {}
    for dest in plan:
        top = dest.split('/')[0]
        by_top[top] = by_top.get(top, 0) + 1
    print(f'export: {len(plan)} files, {total} bytes; ' + ', '.join(f'{k}={v}' for k, v in sorted(by_top.items())) + f'; stale={len(stale)}')
    for rel, why in skipped:
        print(f'  skipped {rel}  ({why})')
    if dry:
        return
    for p in stale:
        p.unlink()
    for dest, p in plan.items():
        out = REPO / dest
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, out)
    for m in managed:  # drop folders emptied by removals
        for d in sorted((REPO / m).rglob('*'), key=lambda x: -len(x.parts)) if (REPO / m).exists() else []:
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
    if '--no-audit' in sys.argv:
        return
    audit = REPO / 'site/scripts/audit-public.mjs'
    allow = REPO / 'audit-allow.json'
    roots = [str(REPO / r) for r in ('autoloop', 'site', 'research', 'scripts', '.github', 'README.md', '.gitignore', 'audit-allow.json') if (REPO / r).exists()]
    cmd = ['node', str(audit), *roots] + (['--allow', str(allow), '--strict-allow'] if allow.exists() else [])
    sys.stdout.flush()
    result = subprocess.run(cmd, cwd=REPO, env={**os.environ, 'AUDIT_PRIVATE_ROOT': env['AUDIT_PRIVATE_ROOT']})
    sys.exit(result.returncode)


if __name__ == '__main__':
    main()
