#!/usr/bin/env node
// Public-data audit for anything that leaves this machine (the built site, the public repo tree).
// usage: node scripts/audit-public.mjs <dir> [<dir> ...]
//          [--route-sidecar <file>]...   raw route id sidecar(s); read locally, never copied or printed
//          [--private-root <dir>]        where to discover sidecars and pod/volume ids (default: AUDIT_PRIVATE_ROOT or ../../../private from this script)
//          [--allow <file>]              allowlist JSON: [{ "rule", "file" (regex on relative path), "match" | "sha256" (exact match), "reason" }]
//          [--require-sidecar]           fail (exit 2) if no route sidecar was found
//          [--strict-allow]              fail (exit 2) if an allowlist entry matched nothing
//          [--json]                      print the summary as JSON
// exit: 0 clean, 1 findings, 2 usage or configuration error
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const roots = [], sidecars = [];
let privateRoot = process.env.AUDIT_PRIVATE_ROOT || resolve(HERE, '../../../private');
let allowFile = existsSync(join(HERE, 'audit-allow.json')) ? join(HERE, 'audit-allow.json') : null;
let requireSidecar = false, strictAllow = false, asJson = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--route-sidecar') sidecars.push(args[++i]);
  else if (a === '--private-root') privateRoot = args[++i];
  else if (a === '--allow') allowFile = args[++i];
  else if (a === '--require-sidecar') requireSidecar = true;
  else if (a === '--strict-allow') strictAllow = true;
  else if (a === '--json') asJson = true;
  else if (a.startsWith('--')) { console.error(`unknown option ${a}`); process.exit(2); }
  else roots.push(a);
}
if (!roots.length) { console.error('usage: audit-public.mjs <dir> [...]'); process.exit(2); }
if (process.env.AUDIT_ROUTE_SIDECAR) sidecars.push(...process.env.AUDIT_ROUTE_SIDECAR.split(':').filter(Boolean));

const SKIP_DIRS = new Set(['node_modules', '.venv', 'credentials', '.git', '__pycache__']);
function* walk(dir, filter = () => true, skipMirror = false, depth = 0) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !(skipMirror && e.name.startsWith('volume-mirror')) && depth < 14) yield* walk(p, filter, skipMirror, depth + 1); }
    else if (e.isFile() && filter(p)) yield p;
  }
}

// Local-only deny material. Values stay in memory; the report shows masked forms only.
const routeIds = new Set();
const knownIds = new Set((process.env.AUDIT_DENY_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const privateRootFound = existsSync(privateRoot);
if (privateRootFound && !process.env.AUDIT_ROUTE_SIDECAR) {
  for (const p of walk(privateRoot, f => f.endsWith('/route-token-raw.json'))) sidecars.push(p);
}
for (const f of sidecars) {
  try {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    for (const v of Object.values(d.routes ?? {})) {
      if (v && v.route_id != null) routeIds.add(String(v.route_id));
      for (const x of v?.route_version_ids ?? []) routeIds.add(String(x));
    }
  } catch { console.error(`cannot read route sidecar (${relative(process.cwd(), f).length} chars path)`); process.exit(2); }
}
if (requireSidecar && routeIds.size === 0) { console.error('route sidecar required but none found'); process.exit(2); }
if (privateRootFound) {
  const ID_KEY = /"(?:podId|pod_id|volumeId|volume_id|networkVolumeId|network_volume_id)"\s*:\s*"([a-z0-9]{8,20})"/g;
  for (const p of walk(privateRoot, f => /\.(json|jsonl)$/.test(f), true)) {
    let st; try { st = statSync(p); } catch { continue; }
    if (st.size > 4 * 1024 * 1024) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(ID_KEY)) knownIds.add(m[1]);
  }
}
const allow = allowFile ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];

const mask = s => s.length <= 4 ? '*'.repeat(s.length) : `${s.slice(0, 2)}…(${s.length})`;
const maskEmail = s => { const [u, d] = s.split('@'); return `${u[0]}***@${d}`; };
const RULES = [
  { id: 'local-path', re: /(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|\/var\/folders\/|[A-Za-z]:\\\\?Users\\)[^\s"'`<>)]{0,80}/g, show: s => s },
  { id: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, show: maskEmail },
  { id: 'secret', re: /sk-an[t]-[A-Za-z0-9_-]*|\bsk-[A-Za-z0-9_-]{16,}|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*KEY-----|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}|\brpa_[A-Za-z0-9]{20,}|aws_secre[t]_access_key|(?:api[_-]?key|secret[_-]?key|access[_-]?key|password)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/gi, show: mask },
  { id: 'private-net', re: /\b(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|0\.0\.0\.0)\b|\/\/localhost\b|\blocalhost:\d{2,5}\b/gi, show: s => s },
  { id: 'cloud-endpoint', re: /\b[a-z0-9.-]*\.?amazonaws\.com\b|\b[a-z0-9.-]*r2\.cloudflarestorage\.com\b|\bs3api-[a-z0-9-]+\.runpod\.io\b|\b[a-z0-9-]+\.proxy\.runpod\.net\b|\bssh\.runpod\.io\b|\bstorage\.googleapis\.com\b|\bs3:\/\/[a-z0-9][a-z0-9.-]+/gi, show: s => s },
  { id: 'runpod-id', re: /(?<![A-Za-z0-9_\\])[a-z0-9]{14}(?![A-Za-z0-9_])/g, keep: s => /\d/.test(s) && /[g-z]/.test(s), show: mask },
  { id: 'known-id', ids: knownIds, show: mask },
  { id: 'route-id', show: s => s },
];

const ROUTE_KEY = /^route[_-]?(?:version[_-]?)?ids?$/i;
const ROUTE_TEXT = /["']?\b(route[_-]?(?:version[_-]?)?ids?)\b["']?\s*[:=]\s*(\[[^\]]{0,400}\]|["']?-?\d{1,12}["']?)/gi;
function routeFindings(text) {
  const out = [];
  for (const m of text.matchAll(ROUTE_TEXT)) {
    for (const n of m[2].matchAll(/\d{1,12}/g)) out.push({ index: m.index, match: `${m[1]}=${n[0]}`, inSidecar: routeIds.has(n[0]) });
  }
  return out;
}
function jsonRouteCheck(value, path, out) {
  if (Array.isArray(value)) { value.forEach((v, i) => jsonRouteCheck(v, `${path}[${i}]`, out)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (ROUTE_KEY.test(k)) {
      for (const x of (Array.isArray(v) ? v : [v])) if ((typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)))) out.push({ path: `${path}.${k}`, value: String(x), inSidecar: routeIds.has(String(x)) });
    }
    jsonRouteCheck(v, `${path}.${k}`, out);
  }
}

const findings = [], perRule = Object.fromEntries(RULES.map(r => [r.id, 0]));
let files = 0, bytes = 0;
// An entry pins one rule to files (regex on the root-relative path) and, optionally, to one exact match by text or by sha256.
const digest = s => createHash('sha256').update(s).digest('hex');
const used = new Set();
const allowed = (rule, file, match) => {
  const hit = allow.filter(a => a.rule === rule && new RegExp(a.file).test(file) && (a.match === undefined || a.match === match) && (a.sha256 === undefined || a.sha256 === digest(match)));
  hit.forEach(a => used.add(a));
  return hit.length > 0;
};
function record(rule, file, offset, match, show) {
  if (allowed(rule, file, match)) return;
  perRule[rule]++;
  findings.push({ rule, file, offset, excerpt: show(match), sha256: digest(match) });
}
for (const root of roots) {
  const target = resolve(root), single = existsSync(target) && statSync(target).isFile();
  const base = single ? dirname(target) : target;
  for (const p of single ? [target] : walk(base)) {
    const buf = readFileSync(p); files++; bytes += buf.length;
    const fromCwd = relative(process.cwd(), p), rel = fromCwd.startsWith('..') ? relative(base, p) : fromCwd, text = buf.toString('utf8');
    const byteOffset = i => Buffer.byteLength(text.slice(0, i), 'utf8');
    for (const r of RULES) {
      if (r.re) {
        r.re.lastIndex = 0;
        for (const m of text.matchAll(r.re)) if (!r.keep || r.keep(m[0])) record(r.id, rel, byteOffset(m.index), m[0], r.show);
      } else if (r.ids && r.ids.size) {
        for (const id of r.ids) { let i = -1; while ((i = text.indexOf(id, i + 1)) !== -1) { const before = text[i - 1] ?? '', after = text[i + id.length] ?? ''; if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) record(r.id, rel, byteOffset(i), id, r.show); } }
      }
    }
    if (p.endsWith('.json')) {
      const out = []; try { jsonRouteCheck(JSON.parse(text), '$', out); } catch { /* not JSON; the text pass below still runs */ }
      for (const f of out) record('route-id', rel, 0, `${f.path}=${f.value}${f.inSidecar ? ' (raw id in sidecar)' : ''}`, s => s);
    } else {
      for (const f of routeFindings(text)) record('route-id', rel, byteOffset(f.index), `${f.match}${f.inSidecar ? ' (raw id in sidecar)' : ''}`, s => s);
    }
  }
}

const unusedAllow = allow.map((a, index) => ({ index, rule: a.rule, file: a.file, reason: a.reason })).filter(u => !used.has(allow[u.index]));
const summary = { roots: roots.map(r => relative(process.cwd(), resolve(r)) || '.'), files, bytes, perRule, findings: findings.length,
  denyMaterial: { routeSidecars: sidecars.length, rawRouteIds: routeIds.size, knownPodOrVolumeIds: knownIds.size, privateRootFound }, allowEntries: allow.length, unusedAllow };
if (asJson) console.log(JSON.stringify({ ...summary, hits: findings }, null, 1));
else {
  console.log(`audit: ${files} files, ${bytes} bytes; sidecars=${sidecars.length} rawRouteIds=${routeIds.size} knownIds=${knownIds.size} allow=${allow.length} unusedAllow=${unusedAllow.length}`);
  for (const [k, v] of Object.entries(perRule)) console.log(`  ${k.padEnd(15)} ${v}`);
  for (const f of findings.slice(0, 400)) console.log(`  ${f.rule.padEnd(15)} ${f.file}:${f.offset}  ${f.excerpt}`);
  if (findings.length > 400) console.log(`  … ${findings.length - 400} more`);
  for (const u of unusedAllow) console.log(`  unused-allow    #${u.index} ${u.rule} ${u.file}  ${u.reason ?? ''}`);
  console.log(findings.length ? `FAIL ${findings.length} finding(s)` : strictAllow && unusedAllow.length ? `FAIL ${unusedAllow.length} allowlist entr${unusedAllow.length === 1 ? 'y' : 'ies'} matched nothing` : 'PASS');
}
process.exit(findings.length ? 1 : strictAllow && unusedAllow.length ? 2 : 0);
