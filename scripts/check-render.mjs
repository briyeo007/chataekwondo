// 검증: "현재 HTML에서 추출한 데이터"로 렌더링한 결과가 원본 HTML과 같은지 비교한다.
// 공백·속성 순서·data-cms 표시 같은 화면에 영향 없는 차이는 무시하고, 글자·태그·속성을 비교한다.
//   node scripts/check-render.mjs            → 전 페이지 비교
//   node scripts/check-render.mjs --data x.json  → 지정 데이터로 렌더 (예: DB 백업과 비교)
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'parse5';
import { ROOT, CMS_PAGES, read, extractAll } from './lib/extract.mjs';

const args = process.argv.slice(2);
const dataArg = args.includes('--data') ? args[args.indexOf('--data') + 1] : null;

const data = dataArg ? JSON.parse(readFileSync(dataArg, 'utf8')) : extractAll();
mkdirSync(join(ROOT, '.cms'), { recursive: true });
const dataFile = join(ROOT, '.cms', 'check-data.json');
writeFileSync(dataFile, JSON.stringify(data));
process.env.CMS_LOCAL_DATA = dataFile;

const { default: handler } = await import('../api/render.js');

async function render(query) {
  let body = '';
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { body = b; } };
  await handler({ url: `/api/render?${query}` }, res);
  return { status: res.statusCode, mode: res.headers['X-CMS'], body };
}

// 화면에 영향을 주는 요소만 정규화해서 한 줄씩 나열
function canonical(html) {
  const out = [];
  const visit = (n, depth) => {
    if (n.nodeName === '#comment') return;
    if (n.nodeName === '#text') {
      const t = n.value.replace(/[\s ]+/g, ' ').trim();
      if (t) out.push(`${'  '.repeat(depth)}"${t}"`);
      return;
    }
    if (n.tagName) {
      const attrs = (n.attrs || [])
        .filter(a => !a.name.startsWith('data-cms'))
        .map(a => `${a.name}=${JSON.stringify(a.name === 'style' ? a.value.replace(/\s+/g, '').replace(/;$/, '') : a.value)}`)
        .sort().join(' ');
      out.push(`${'  '.repeat(depth)}<${n.tagName}${attrs ? ' ' + attrs : ''}>`);
      // 메인 "최근 도장 소식"은 최신 6개 자동 표시로 의도적으로 바뀌므로 비교 제외
      if ((n.attrs || []).some(a => a.name === 'data-cms-list' && a.value === 'index-news')) {
        out.push(`${'  '.repeat(depth + 1)}(최근 소식 목록: 비교 제외)`);
        return;
      }
    }
    for (const k of n.childNodes || []) visit(k, depth + 1);
    if (n.content) for (const k of n.content.childNodes) visit(k, depth + 1);
  };
  visit(parse(html), 0);
  return out;
}

function diff(a, b) {
  const max = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < max && out.length < 6; i++) {
    if (a[i] !== b[i]) out.push(`  줄 ${i}\n    원본: ${a[i]}\n    렌더: ${b[i]}`);
  }
  return out;
}

let fails = 0;
const report = (name, orig, rendered, mode) => {
  const d = diff(canonical(orig), canonical(rendered));
  if (d.length) { fails++; console.log(`✗ ${name} [${mode}]\n${d.join('\n')}`); }
  else console.log(`✓ ${name} [${mode}]`);
};

for (const page of CMS_PAGES) {
  const r = await render(`page=${page}`);
  report(`${page}.html`, read(`${page}.html`), r.body, r.mode);
}
for (const p of data.posts) {
  const file = `post-${p.slug}.html`;
  const r = await render(`post=${p.slug}`);
  if (!existsSync(join(ROOT, file))) { console.log(`· ${file} — 관리자 페이지에서 새로 작성한 글 (원본 파일 없음, ${r.status})`); continue; }
  if (r.status === 404) { console.log(`· ${file} — 삭제 또는 비공개 처리된 글`); continue; }
  report(file, read(file), r.body, r.mode);
}
console.log(fails ? `\n차이 ${fails}건` : '\n모든 페이지 동일');
process.exit(fails ? 1 : 0);
