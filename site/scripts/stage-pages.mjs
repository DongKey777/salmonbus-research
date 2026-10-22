#!/usr/bin/env node
// Finishes the GitHub Pages build in dist-pages/: adds the saved API snapshots and THIRD-PARTY-LICENSES.txt, drops dotfiles
// (e.g. a publisher's half-written candidate file copied from public/), and checks the subpath wiring.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeThirdPartyLicenses } from './third-party-licenses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-pages'), SNAP = join(ROOT, 'snapshots');
if (!existsSync(join(OUT, 'index.html'))) { console.error('dist-pages/index.html missing: run vite build --mode pages first'); process.exit(2); }
const removed = [];
(function prune(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.name.startsWith('.') || e.name.endsWith('.map')) { rmSync(p, { recursive: true, force: true }); removed.push(p.slice(OUT.length + 1)); }
    else if (e.isDirectory()) prune(p);
  }
})(OUT);
const staged = [];
if (existsSync(SNAP)) {
  mkdirSync(join(OUT, 'snapshots'), { recursive: true });
  for (const f of readdirSync(SNAP)) if (/^[a-z0-9-]+\.json$/.test(f)) { copyFileSync(join(SNAP, f), join(OUT, 'snapshots', f)); staged.push(f); }
}
const notices = (await writeThirdPartyLicenses(join(OUT, 'THIRD-PARTY-LICENSES.txt'))).map(p => `${p.name}@${p.version}`);
const html = readFileSync(join(OUT, 'index.html'), 'utf8');
const base = process.env.PAGES_BASE ?? '/salmonbus-research/';
if (!html.includes(`src="${base}assets/`)) { console.error(`index.html does not load assets from ${base}`); process.exit(1); }
console.log(JSON.stringify({ staged, removed, base, notices }));
