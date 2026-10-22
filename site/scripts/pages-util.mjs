#!/usr/bin/env node
// Change detection for the Pages deploy.
//   digest                      sha256 over the build inputs (src, public, snapshots, config), JSON with servedAt removed
//   volatile-only <repo> <dir>  exit 0 when the staged changes under <dir> only move top-level servedAt values
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VOLATILE = ['servedAt'];
const stable = (text) => {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const k of VOLATILE) delete value[k];
    return JSON.stringify(value);
  } catch { return text; }
};
function* files(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p); else yield p;
  }
}
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'digest') {
  const h = createHash('sha256');
  const inputs = ['src', 'public', 'snapshots', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json'].map(p => join(ROOT, p));
  for (const input of inputs) {
    const list = !existsSync(input) ? [] : statSync(input).isDirectory() ? [...files(input)] : [input];
    for (const f of list) {
      const text = readFileSync(f, 'utf8');
      h.update(relative(ROOT, f)).update('\0').update(f.endsWith('.json') ? stable(text) : text).update('\0');
    }
  }
  console.log(h.digest('hex'));
} else if (cmd === 'volatile-only') {
  const [repo, dir] = rest;
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const changed = git('diff', '--cached', '--name-status', '--', dir).trim().split('\n').filter(Boolean);
  if (!changed.length) process.exit(0);
  for (const line of changed) {
    const [status, path] = line.split('\t');
    if (status !== 'M' || !path.endsWith('.json')) process.exit(1);
    const before = git('show', `HEAD:${path}`), after = git('show', `:${path}`);
    if (stable(before) !== stable(after)) process.exit(1);
  }
  process.exit(0);
} else {
  console.error('usage: pages-util.mjs digest | volatile-only <repo> <dir>');
  process.exit(2);
}
