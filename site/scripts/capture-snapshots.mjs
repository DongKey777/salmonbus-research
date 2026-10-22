#!/usr/bin/env node
// Saves static copies of the local API responses that the public build reads instead of live endpoints.
// usage: node --experimental-strip-types scripts/capture-snapshots.mjs [--origin http://127.0.0.1:62421]
// Each response must pass the same contract the site uses; a failed or unreachable source keeps the previous copy.
// Output: snapshots/<name>.json (site root, outside public/) — staged into the pages build by stage-pages.mjs.
import { mkdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--origin');
const origin = at >= 0 && args[at + 1] ? args[at + 1] : (process.env.SNAPSHOT_ORIGIN ?? 'http://127.0.0.1:62421');
const { verifySnapshot } = await import(join(ROOT, 'src/actualcycles/contract.ts'));
const { verifyPreparation } = await import(join(ROOT, 'src/preparation/contract.ts'));
const SOURCES = [
  { name: 'real-cycles', path: '/api/v7/real-cycles/snapshot', verify: verifySnapshot, limit: 4 * 1024 * 1024 },
  { name: 'preparation', path: '/api/v3/preparation/snapshot', verify: verifyPreparation, limit: 262144 },
];
const outDir = join(ROOT, 'snapshots');
mkdirSync(outDir, { recursive: true });
const report = [];
for (const s of SOURCES) {
  const dest = join(outDir, `${s.name}.json`);
  try {
    const response = await fetch(origin + s.path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const text = await response.text();
    if (text.length > s.limit) throw new Error('RESPONSE_LIMIT');
    s.verify(JSON.parse(text));
    const tmp = join(outDir, `.${s.name}.tmp`);
    writeFileSync(tmp, text.endsWith('\n') ? text : text + '\n');
    renameSync(tmp, dest);
    report.push({ name: s.name, captured: true, bytes: text.length });
  } catch (error) {
    report.push({ name: s.name, captured: false, kept: existsSync(dest), error: String(error?.message ?? error).slice(0, 120) });
  }
}
console.log(JSON.stringify({ snapshots: report }));
