#!/usr/bin/env node
// Third-party notices for the Pages build: every npm package the pages module graph puts into the bundle,
// with its package.json license id and the LICENSE/NOTICE files it ships.
// usage: node scripts/third-party-licenses.mjs [out-file]   (default dist-pages/THIRD-PARTY-LICENSES.txt)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//;
const NOTICE_FILE = /^(?:licen[cs]es?|copying|notice|third-party-licen[cs]es?)(?:[.-][\w.-]*)?$/i;
const VITE_BUNDLED = /^#+\s*Licenses of bundled dependencies[\s\S]*$/m;
const rank = f => /notice/i.test(f) ? 3 : /third-party/i.test(f) ? 2 : f.includes('/') ? 1 : 0;

const findPkg = (name, from) => {
  for (let d = from; ; d = dirname(d)) {
    const p = join(d, 'node_modules', name);
    if (existsSync(join(p, 'package.json'))) return p;
    if (dirname(d) === d) return null;
  }
};
function owner(id, vite) {
  const path = id.split('?')[0];
  if (path.startsWith('\0')) {
    const seg = path.slice(1).split('/'), name = seg[0].startsWith('@') ? seg.slice(0, 2).join('/') : seg[0];
    const dir = findPkg(name, vite) ?? findPkg(name, ROOT);
    if (!dir) throw new Error(`virtual module without a package: ${path.slice(1)}`);
    return dir;
  }
  const m = path.match(PKG_DIR);
  if (m) return m[1];
  if (path.startsWith(ROOT + '/')) return null;
  throw new Error(`bundled module outside the site and node_modules: ${path}`);
}
const licenseId = j => typeof j.license === 'string' ? j.license : (j.license?.type ?? ((j.licenses ?? []).map(l => l.type ?? l).join(' OR ') || 'UNKNOWN'));
function noticeFiles(dir) {
  const names = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!NOTICE_FILE.test(e.name)) continue;
    if (e.isDirectory()) { for (const f of readdirSync(join(dir, e.name)).sort()) if (statSync(join(dir, e.name, f)).isFile()) names.push(`${e.name}/${f}`); }
    else if (e.isFile()) names.push(e.name);
  }
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map(file => {
    const raw = readFileSync(join(dir, file), 'utf8').replace(/\r\n?/g, '\n');
    const cut = raw.replace(VITE_BUNDLED, '');
    const text = cut === raw ? raw.trimEnd() : `${cut.trimEnd()}\n\n[이후 'Licenses of bundled dependencies' 절은 이 패키지의 Node 배포물에 묶인 의존성 목록이고 사이트 번들에는 들어가지 않아 옮기지 않았습니다.]`;
    return { file, text };
  });
}

export async function writeThirdPartyLicenses(outFile) {
  const { build } = await import('vite');
  const vite = findPkg('vite', ROOT);
  const result = await build({ root: ROOT, mode: 'pages', logLevel: 'silent', build: { write: false, emptyOutDir: false, copyPublicDir: false } });
  const dirs = new Set();
  for (const c of [result].flat().flatMap(r => r.output)) if (c.type === 'chunk') for (const id of c.moduleIds) { const d = owner(id, vite); if (d) dirs.add(d); }
  const pkgs = new Map();
  for (const dir of dirs) {
    const j = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')), key = `${j.name}@${j.version}`;
    if (pkgs.has(key)) continue;
    const files = noticeFiles(dir), author = (typeof j.author === 'string' ? j.author : j.author?.name ?? '').replace(/\s*[<(].*$/, '');
    if (!files.length) console.error(`third-party-licenses: ${key} ships no license file`);
    pkgs.set(key, { name: j.name, version: j.version, license: licenseId(j), files, author });
  }
  const list = [...pkgs.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }));
  const SEP = '='.repeat(80);
  writeFileSync(outFile, [
    'THIRD-PARTY LICENSES', '',
    '이 사이트의 공개 빌드에 포함된 외부 패키지의 라이선스 고지입니다.',
    '패키지마다 이름, 버전, package.json의 라이선스 식별자와 패키지에 들어 있는 라이선스·NOTICE 파일 원문을 옮겼습니다.', '',
    ...list.map(p => `- ${p.name} ${p.version} (${p.license})`),
    ...list.flatMap(p => ['', SEP, `${p.name} ${p.version}`, `License: ${p.license}`,
      ...(p.files.length ? p.files.flatMap(f => ['', `--- ${f.file} ---`, '', f.text]) : ['', `패키지에 라이선스 파일이 없습니다.${p.author ? ` 저작자: ${p.author}` : ''}`])]),
    '',
  ].join('\n'));
  return list.map(({ name, version, license, files }) => ({ name, version, license, files: files.map(f => f.file) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = resolve(process.argv[2] ?? join(ROOT, 'dist-pages', 'THIRD-PARTY-LICENSES.txt'));
  const list = await writeThirdPartyLicenses(out);
  console.log(JSON.stringify({ out: relative(ROOT, out), packages: list.map(p => `${p.name}@${p.version} ${p.license} [${p.files.join(', ')}]`) }, null, 1));
}
