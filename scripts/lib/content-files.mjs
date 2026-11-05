// 서버 콘텐츠 ↔ 프로젝트 content/ 폴더 변환.
//
// content/
//   blocks.json             페이지 문구·사진 (value, meta 만 수정 가능)
//   gallery.json            갤러리 (id 없는 항목을 추가하면 새 사진)
//   posts/<slug>.json       글 정보 (새 파일 = 새 글)
//   posts/<slug>.body.html  글 본문
//   posts/<slug>.after.html 본문 아래 영역 (블로그 링크·현장 사진)
//   media/...               관장님이 올린 사진 사본 (원본은 Vercel Blob)
//   _충돌/                   동시에 수정되어 반영하지 못한 내 수정본
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const POST_FIELDS = ['title', 'category', 'published_on', 'excerpt', 'cover_url', 'cover_alt', 'list_title', 'list_category',
  'card_image_url', 'card_image_alt', 'meta_text', 'seo_title', 'is_published', 'sort'];
export const GALLERY_FIELDS = ['pane', 'src', 'title', 'caption', 'alt', 'big', 'sort'];

const json = v => JSON.stringify(v, null, 2) + '\n';
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k] ?? null]));

const README = `# content/ — 관리자 페이지 콘텐츠 사본 (자동 동기화)

이 폴더는 **동기화 프로그램(npm run sync)이 자동으로 관리**합니다.
콘텐츠의 원본은 홈페이지 서버 저장소이며, 관장님이 관리자 페이지에서 저장하면 이 폴더에 자동으로 반영됩니다.

- 여기서 파일을 수정하면 동기화 프로그램이 서버에 올립니다 (관장님이 같은 항목을 먼저 고쳤다면 반영하지 않고 _충돌/ 폴더에 내 수정본을 남깁니다).
- blocks.json 은 value / meta 만 수정할 수 있습니다. 새 항목은 HTML에 data-cms 를 붙이고 npm run cms:seed 로 추가합니다.
- 새 글: posts/<영문-slug>.json (+ .body.html) 파일을 만들면 추가됩니다. 주소는 /post-<slug>.html
- 삭제는 관리자 페이지의 휴지통을 사용하세요 (여기서 지워도 서버에서는 삭제되지 않고 다시 생깁니다).
- media/ 는 사진 사본입니다 (배포에는 포함되지 않음).
`;

/** 서버 내보내기 → { 상대경로: 파일내용 } */
export function exportToFiles(exp) {
  const { doc, bodies } = exp;
  const files = { 'README.md': README };
  files['blocks.json'] = json(Object.values(doc.blocks)
    .sort((a, b) => a.page.localeCompare(b.page) || a.sort - b.sort)
    .map(b => ({ key: b.key, page: b.page, label: b.label, type: b.type, value: b.value, meta: b.meta || {} })));
  files['gallery.json'] = json(Object.values(doc.gallery).filter(g => !g.deleted_at)
    .sort((a, b) => a.pane.localeCompare(b.pane) || a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at)))
    .map(g => ({ id: g.id, ...pick(g, GALLERY_FIELDS) })));
  for (const p of Object.values(doc.posts).filter(p => !p.deleted_at)) {
    files[`posts/${p.slug}.json`] = json({ id: p.id, ...pick(p, POST_FIELDS) });
    files[`posts/${p.slug}.body.html`] = bodies[p.id]?.body_html || '';
    files[`posts/${p.slug}.after.html`] = bodies[p.id]?.after_html || '';
  }
  return files;
}

/** content/ 폴더 읽기 → { blocks, gallery, posts } (파싱 오류는 예외) */
export function readContentDir(dir) {
  const read = f => readFileSync(join(dir, f), 'utf8');
  const parse = f => { try { return JSON.parse(read(f)); } catch (e) { throw new Error(`${f} JSON 형식 오류: ${e.message}`); } };
  const out = { blocks: [], gallery: [], posts: [] };
  if (existsSync(join(dir, 'blocks.json'))) out.blocks = parse('blocks.json');
  if (existsSync(join(dir, 'gallery.json'))) out.gallery = parse('gallery.json');
  if (existsSync(join(dir, 'posts'))) {
    for (const f of readdirSync(join(dir, 'posts')).filter(f => f.endsWith('.json'))) {
      const slug = f.replace(/\.json$/, '');
      const p = parse(`posts/${f}`);
      const html = ext => (existsSync(join(dir, 'posts', `${slug}.${ext}.html`)) ? read(`posts/${slug}.${ext}.html`) : '');
      out.posts.push({ ...p, slug, body_html: html('body'), after_html: html('after'), _file: `posts/${f}` });
    }
  }
  return out;
}

/** 내보내기 → 비교 기준(base) */
export function exportToBase(exp) {
  const { doc, bodies } = exp;
  return {
    blocks: Object.fromEntries(Object.values(doc.blocks).map(b => [b.key, { value: b.value, meta: b.meta || {}, version: b.version }])),
    gallery: Object.fromEntries(Object.values(doc.gallery).filter(g => !g.deleted_at).map(g => [g.id, { ...pick(g, GALLERY_FIELDS), version: g.version }])),
    posts: Object.fromEntries(Object.values(doc.posts).filter(p => !p.deleted_at).map(p => [p.id, {
      slug: p.slug, ...pick(p, POST_FIELDS), body_html: bodies[p.id]?.body_html || '', after_html: bodies[p.id]?.after_html || '', version: p.version,
    }])),
  };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * 로컬 파일과 기준(base)을 비교해 서버에 올릴 변경 목록 생성
 * @returns {{ changes: object[], warnings: string[] }}
 */
export function diffLocal(local, base) {
  const changes = [];
  const warnings = [];
  for (const b of local.blocks) {
    const o = base.blocks[b.key];
    if (!o) { warnings.push(`blocks.json: 새 항목 ${b.key} 는 HTML에 data-cms 를 붙이고 npm run cms:seed 로 추가하세요.`); continue; }
    const data = {};
    if (b.value !== o.value) data.value = b.value;
    if (!same(b.meta || {}, o.meta)) data.meta = b.meta || {};
    if (Object.keys(data).length) changes.push({ ref: `block:${b.key}`, table: 'content_blocks', key: b.key, version: o.version, data, file: 'blocks.json', label: `페이지 문구 ${b.key}` });
  }
  for (const g of local.gallery) {
    const data = Object.fromEntries(GALLERY_FIELDS.filter(k => k in g).map(k => [k, g[k]]));
    if (!g.id) { changes.push({ ref: `gallery:new:${g.src}`, table: 'gallery_items', version: null, data, file: 'gallery.json', label: `갤러리 추가 ${g.caption || g.src}` }); continue; }
    const o = base.gallery[g.id];
    if (!o) continue;
    const diff = Object.fromEntries(GALLERY_FIELDS.filter(k => k in g && !same(g[k], o[k])).map(k => [k, g[k]]));
    if (Object.keys(diff).length) changes.push({ ref: `gallery:${g.id}`, table: 'gallery_items', key: g.id, version: o.version, data: diff, file: 'gallery.json', label: `갤러리 ${g.caption || g.src}` });
  }
  const localIds = new Set(local.gallery.map(g => g.id).filter(Boolean));
  const missing = Object.keys(base.gallery).filter(id => !localIds.has(id));
  if (missing.length) warnings.push(`gallery.json: 지운 사진 ${missing.length}장은 서버에서 삭제되지 않습니다 (관리자 페이지 휴지통 사용). 다음 동기화 때 다시 표시됩니다.`);

  const bySlug = new Map(Object.entries(base.posts).map(([id, p]) => [p.slug, { id, ...p }]));
  for (const p of local.posts) {
    const o = (p.id && base.posts[p.id] ? { id: p.id, ...base.posts[p.id] } : null) || bySlug.get(p.slug);
    const fields = [...POST_FIELDS, 'body_html', 'after_html'];
    if (!o) {
      if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(p.slug)) { warnings.push(`${p._file}: 파일 이름은 영문 소문자·숫자·하이픈만 사용할 수 있습니다.`); continue; }
      const data = { slug: p.slug, ...Object.fromEntries(fields.filter(k => p[k] !== undefined && p[k] !== null).map(k => [k, p[k]])) };
      if (!data.published_on) data.published_on = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      changes.push({ ref: `post:new:${p.slug}`, table: 'posts', version: null, data, file: p._file, label: `새 글 post-${p.slug}.html` });
      continue;
    }
    const diff = Object.fromEntries(fields.filter(k => k in p && !same(p[k], o[k])).map(k => [k, p[k]]));
    if (Object.keys(diff).length) changes.push({ ref: `post:${o.id}`, table: 'posts', key: o.id, version: o.version, data: diff, file: p._file, slug: p.slug, label: `글 ${p.slug} (${Object.keys(diff).join(', ')})` });
  }
  return { changes, warnings };
}

/** check-render / 렌더링 대체 데이터 형식으로 변환 */
export function exportToRenderData(exp) {
  const { doc, bodies } = exp;
  return {
    blocks: Object.values(doc.blocks),
    posts: Object.values(doc.posts).map(p => ({ ...p, ...(bodies[p.id] || {}) })),
    gallery: Object.values(doc.gallery),
  };
}
