import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, PUBLIC_SITE, SITE_MARK, siteUrl, viewUrl } from '../src/site/env.ts';
import { RESEARCH_SECTIONS } from '../src/ui/sections.ts';

test('site env: outside Vite the site is the local monitor at /', () => {
  assert.equal(BASE_URL, '/');
  assert.equal(PUBLIC_SITE, false);
  assert.equal(SITE_MARK, 'LOCAL RESEARCH');
});

test('site env: paths resolve against the base without doubling slashes', () => {
  assert.equal(siteUrl('/autoloop-report.json'), '/autoloop-report.json');
  assert.equal(siteUrl('real-pilot/summary.json'), '/real-pilot/summary.json');
  assert.equal(siteUrl('api/v7/real-cycles/snapshot'), '/api/v7/real-cycles/snapshot');
  assert.equal(viewUrl('autoloop'), '/?view=autoloop');
  assert.equal(viewUrl('preparation', { attempt: 'A B' }), '/?view=preparation&attempt=A+B');
});

test('navigation: loop status and route map come first, every link stays under the base', () => {
  assert.deepEqual(RESEARCH_SECTIONS.map(s => s.label), ['자율 루프', '노선도', '실자료 반복', '실자료 평가', '전체 이력', '자료 검증']);
  assert.equal(RESEARCH_SECTIONS[1].href, '/autoloop-route.html');
  for (const s of RESEARCH_SECTIONS) assert.ok(s.href.startsWith(BASE_URL), s.href);
  assert.deepEqual(RESEARCH_SECTIONS.filter(s => s.localOnly).map(s => s.id), ['history']);
});

const ROOT = new URL('..', import.meta.url).pathname;
function audit(files: Record<string, string>, sidecar?: object) {
  const dir = join(ROOT, 'test', `.tmp-audit-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  try {
    for (const [name, body] of Object.entries(files)) { mkdirSync(join(dir, 'site', name, '..'), { recursive: true }); writeFileSync(join(dir, 'site', name), body); }
    const env = { ...process.env, AUDIT_PRIVATE_ROOT: join(dir, 'no-private'), AUDIT_DENY_IDS: 'fakevol001' } as Record<string, string>;
    delete env.AUDIT_ROUTE_SIDECAR;
    const args = [join(ROOT, 'scripts/audit-public.mjs'), join(dir, 'site'), '--json', '--allow', join(dir, 'none.json')];
    writeFileSync(join(dir, 'none.json'), '[]');
    if (sidecar) { writeFileSync(join(dir, 'sidecar.json'), JSON.stringify(sidecar)); args.push('--route-sidecar', join(dir, 'sidecar.json')); }
    try { return { code: 0, out: JSON.parse(execFileSync('node', args, { env, encoding: 'utf8' })) }; }
    catch (error) { const e = error as { status: number; stdout: string }; return { code: e.status, out: JSON.parse(e.stdout) }; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('audit: a clean tree passes', () => {
  const r = audit({ 'index.html': '<!doctype html><title>x</title>', 'data.json': '{"routes":[{"token":"11983c18a94b2541"}],"MAE":2.06}' }, { routes: { a: { route_id: 7, route_version_ids: [70] } } });
  assert.equal(r.code, 0); assert.equal(r.out.findings, 0);
});

test('audit: each rule fires and the report never echoes key material', () => {
  const key = ['sk', 'ant', 'api03', 'Zx9Q'].join('-');
  const r = audit({
    'a.json': JSON.stringify({ p: '/Users/someone/x', m: 'me@example.com', k: key, h: 'http://127.0.0.1:8000/', s: 'https://b.s3.us-east-1.amazonaws.com/k', id: 'zz12ab34cd56ef', v: 'fakevol001', routeId: 7 }),
    'b.js': 'const x={route_id: 7}; "-----BEGIN OPENSSH PRIVATE KEY-----"',
  }, { routes: { a: { route_id: 7, route_version_ids: [70] } } });
  assert.equal(r.code, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(r.out.perRule).filter(([, n]) => (n as number) > 0)),
    { 'local-path': 1, email: 1, secret: 2, 'private-net': 1, 'cloud-endpoint': 1, 'runpod-id': 1, 'known-id': 1, 'route-id': 2 });
  const text = JSON.stringify(r.out);
  assert.ok(!text.includes(key) && !text.includes('fakevol001') && !text.includes('me@example.com'));
});
