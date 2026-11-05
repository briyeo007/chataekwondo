// 콘텐츠 데이터 (단일 원본).
// 구조: cms:doc = { blocks, posts, gallery, media } (글 본문 제외) / cms:body:<글id> = { body_html, after_html }
// 모든 쓰기는 mutate() 를 거친다: 읽기 → 항목 버전 확인 → 문서 버전이 그대로일 때만 저장(원자적) → 실패 시 재시도.
// 수정·삭제 직전 내용은 cms:revisions 에 자동 보관된다.
import { randomUUID } from 'node:crypto';
import { kv, KEYS } from './kv.js';

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

const empty = () => ({ blocks: {}, posts: {}, gallery: {}, media: {} });
export const bodyKey = id => `cms:body:${id}`;
const now = () => new Date().toISOString();

export async function loadDoc() {
  const s = await kv();
  if (!s) return null;
  const [doc, ver] = await s.mget([KEYS.DOC, KEYS.VER]);
  return { ver: Number(ver || 0), doc: doc ? { ...empty(), ...JSON.parse(doc) } : empty() };
}

export async function loadBodies(ids) {
  if (!ids.length) return {};
  const s = await kv();
  const vals = await s.mget(ids.map(bodyKey));
  return Object.fromEntries(ids.map((id, i) => [id, vals[i] ? JSON.parse(vals[i]) : { body_html: '', after_html: '' }]));
}

export async function loadRevisions(limit = 150) {
  const s = await kv();
  return (await s.lrange(KEYS.REVS, 0, limit - 1)).map(r => (typeof r === 'string' ? JSON.parse(r) : r));
}

/** 원자적 변경. fn(doc, tx) 안에서 doc 을 수정하고 tx 에 본문 저장·기록을 추가한다. */
export async function mutate(fn) {
  const s = await kv();
  if (!s) throw new HttpError(503, 'not_configured', '저장소가 설정되지 않았습니다.');
  for (let attempt = 0; attempt < 6; attempt++) {
    const { ver, doc } = await loadDoc();
    const tx = {
      sets: {}, dels: [], revisions: [],
      async body(id) { return (await loadBodies([id]))[id]; },
      setBody(id, b) { this.sets[bodyKey(id)] = JSON.stringify(b); },
      delBody(id) { this.dels.push(bodyKey(id)); },
      revision(table, rowKey, op, old) {
        this.revisions.push(JSON.stringify({ id: `${Date.now()}-${randomUUID().slice(0, 8)}`, table_name: table, row_key: rowKey, op, old_data: old, changed_at: now() }));
      },
    };
    const result = await fn(doc, tx);
    const nv = await s.casDoc({ expectVer: ver, doc: JSON.stringify(doc), sets: tx.sets, dels: tx.dels, revisions: tx.revisions });
    if (nv !== null) return { result, ver: nv };
    await new Promise(r => setTimeout(r, 50 + Math.random() * 150));
  }
  throw new HttpError(503, 'busy', '잠시 후 다시 시도해 주세요.');
}

/* ── 테이블 정의 · 입력 검증 ───────────────────────────────────── */
const str = (max, { required = false, nullable = false } = {}) => (v, name) => {
  if (v === null || v === undefined || v === '') {
    if (required) throw new HttpError(400, 'invalid', `${name} 을(를) 입력해 주세요.`);
    return nullable ? null : '';
  }
  if (typeof v !== 'string') throw new HttpError(400, 'invalid', `${name} 형식 오류`);
  if (v.length > max) throw new HttpError(400, 'too_long', `${name} 이(가) 너무 깁니다.`);
  return v;
};
const url = ({ nullable = false, required = false } = {}) => (v, name) => {
  const s = str(1000, { nullable, required })(v, name);
  if (s && !(/^https?:\/\//i.test(s) || (s.startsWith('/') && !s.startsWith('//')))) throw new HttpError(400, 'invalid', `${name} 주소 형식 오류`);
  return s;
};
const bool = v => !!v;
const int = (v, name) => { const n = Number(v ?? 0); if (!Number.isInteger(n) || Math.abs(n) > 1e9) throw new HttpError(400, 'invalid', `${name} 형식 오류`); return n; };
const date = (v, name) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) throw new HttpError(400, 'invalid', `${name} 날짜 형식 오류`); return v; };
const isoOrNull = (v, name) => { if (v === null || v === undefined || v === '') return null; if (Number.isNaN(Date.parse(v))) throw new HttpError(400, 'invalid', `${name} 형식 오류`); return v; };
const meta = (v, name) => { const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; if (JSON.stringify(o).length > 4000) throw new HttpError(400, 'too_long', `${name} 이(가) 너무 깁니다.`); return o; };
const enumOf = list => (v, name) => { if (!list.includes(v)) throw new HttpError(400, 'invalid', `${name} 값 오류`); return v; };
const slug = (v, name) => { if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(v || ''))) throw new HttpError(400, 'invalid', `${name} 형식 오류 (영문 소문자·숫자·하이픈)`); return v; };
const blockKey = (v, name) => { if (!/^[a-z0-9][a-z0-9._-]*$/.test(String(v || ''))) throw new HttpError(400, 'invalid', `${name} 형식 오류`); return v; };

export const TABLES = {
  content_blocks: {
    coll: 'blocks', pk: 'key',
    insert: {
      key: blockKey, page: str(60, { required: true }), label: str(200), sort: int,
      type: enumOf(['text', 'html', 'image', 'number', 'lines']),
    },
    update: { value: str(200000), meta },
  },
  posts: {
    coll: 'posts', pk: 'id', bodies: true,
    insert: { slug },
    update: {
      title: str(300, { required: true }), category: str(60), published_on: date, excerpt: str(1000),
      cover_url: url(), cover_alt: str(300), body_html: str(300000), after_html: str(300000),
      list_title: str(300, { nullable: true }), list_category: str(60, { nullable: true }),
      card_image_url: url({ nullable: true }), card_image_alt: str(300, { nullable: true }),
      meta_text: str(100, { nullable: true }), seo_title: str(300, { nullable: true }),
      is_published: bool, sort: int, deleted_at: isoOrNull,
    },
  },
  gallery_items: {
    coll: 'gallery', pk: 'id',
    insert: {},
    update: {
      pane: enumOf(['all', 'france', 'broadcast', 'exam', 'daily']), src: url({ required: true }),
      title: str(300), caption: str(300), alt: str(300), big: bool, sort: int,
      storage_path: str(500, { nullable: true }), deleted_at: isoOrNull,
    },
  },
};

const DEFAULTS = {
  content_blocks: { label: '', sort: 0, value: '', meta: {} },
  posts: { category: '도장소식', excerpt: '', cover_url: '', cover_alt: '', body_html: '', after_html: '', list_title: null, list_category: null, card_image_url: null, card_image_alt: null, meta_text: null, seo_title: null, is_published: true, sort: 0, deleted_at: null },
  gallery_items: { title: '', caption: '', alt: '', big: false, sort: 0, storage_path: null, deleted_at: null },
};

function table(name) {
  const t = TABLES[name];
  if (!t) throw new HttpError(400, 'invalid', '알 수 없는 종류');
  return t;
}

/** 허용된 필드만 남기고 검증 */
export function clean(name, data, { insert = false } = {}) {
  const t = table(name);
  const rules = insert ? { ...t.insert, ...t.update } : t.update;
  const out = {};
  for (const [k, rule] of Object.entries(rules)) {
    if (k in data) out[k] = rule(data[k], k);
    else if (insert && !(k in (DEFAULTS[name] || {}))) out[k] = rule(undefined, k);
  }
  return out;
}

const splitBodies = item => {
  const { body_html, after_html, ...rest } = item;
  return { rest, bodies: body_html !== undefined || after_html !== undefined ? { body_html, after_html } : null };
};

/* ── 항목 단위 작업 ─────────────────────────────────────────── */

export async function insertItem(name, data, { id, actor = 'admin' } = {}) {
  const t = table(name);
  const values = { ...DEFAULTS[name], ...clean(name, data, { insert: true }) };
  const { result } = await mutate(async (doc, tx) => {
    const coll = doc[t.coll];
    const key = t.pk === 'key' ? values.key : id || randomUUID();
    if (coll[key]) throw new HttpError(409, 'exists', '이미 있는 항목입니다.');
    if (name === 'posts' && Object.values(coll).some(p => p.slug === values.slug)) throw new HttpError(409, 'exists', '같은 주소의 글이 이미 있습니다.');
    const stamp = now();
    const item = { ...values, [t.pk]: key, version: 1, created_at: data.created_at || stamp, updated_at: stamp, updated_by: actor };
    const { rest, bodies } = t.bodies ? splitBodies(item) : { rest: item, bodies: null };
    coll[key] = rest;
    if (t.bodies) tx.setBody(key, { body_html: bodies?.body_html || '', after_html: bodies?.after_html || '' });
    return item;
  });
  return result;
}

export async function updateItem(name, key, version, patch, { actor = 'admin' } = {}) {
  const t = table(name);
  const values = clean(name, patch);
  const { result } = await mutate(async (doc, tx) => {
    const cur = doc[t.coll][key];
    if (!cur) throw new HttpError(404, 'not_found', '항목을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.');
    if (Number(version) !== cur.version) throw new HttpError(409, 'version_conflict', '다른 곳에서 먼저 수정되었습니다.');
    const oldBodies = t.bodies ? await tx.body(key) : null;
    tx.revision(name, key, 'update', { ...cur, ...(oldBodies || {}) });
    const { rest, bodies } = t.bodies ? splitBodies(values) : { rest: values, bodies: null };
    const next = { ...cur, ...rest, version: cur.version + 1, updated_at: now(), updated_by: actor };
    doc[t.coll][key] = next;
    let fullBodies = oldBodies;
    if (bodies) {
      fullBodies = { body_html: bodies.body_html ?? oldBodies.body_html, after_html: bodies.after_html ?? oldBodies.after_html };
      tx.setBody(key, fullBodies);
    }
    return { ...next, ...(fullBodies || {}) };
  });
  return result;
}

export async function deleteItem(name, key) {
  const t = table(name);
  const { result } = await mutate(async (doc, tx) => {
    const cur = doc[t.coll][key];
    if (!cur) throw new HttpError(404, 'not_found', '항목을 찾을 수 없습니다.');
    const oldBodies = t.bodies ? await tx.body(key) : null;
    tx.revision(name, key, 'delete', { ...cur, ...(oldBodies || {}) });
    delete doc[t.coll][key];
    if (t.bodies) tx.delBody(key);
    return cur;
  });
  return result;
}

export async function getItem(name, key) {
  const t = table(name);
  const { doc } = await loadDoc();
  const item = doc[t.coll][key];
  if (!item) throw new HttpError(404, 'not_found', '항목을 찾을 수 없습니다.');
  return t.bodies ? { ...item, ...(await loadBodies([key]))[key] } : item;
}

export async function listItems(name) {
  const t = table(name);
  const { doc } = await loadDoc();
  return Object.values(doc[t.coll]);
}

/** 변경 기록의 내용으로 되돌리기 (현재 버전 기준으로 덮어씀, 없으면 다시 추가) */
export async function restoreRevision(revId) {
  const rev = (await loadRevisions(500)).find(r => r.id === revId);
  if (!rev) throw new HttpError(404, 'not_found', '변경 기록을 찾을 수 없습니다.');
  const t = table(rev.table_name);
  const { doc } = await loadDoc();
  const cur = doc[t.coll][rev.row_key];
  const data = { ...rev.old_data };
  if (cur) {
    const patch = Object.fromEntries(Object.keys(t.update).filter(k => k in data).map(k => [k, data[k]]));
    return updateItem(rev.table_name, rev.row_key, cur.version, patch, { actor: 'restore' });
  }
  return insertItem(rev.table_name, data, { id: rev.row_key, actor: 'restore' });
}

/* ── 사진 목록 ─────────────────────────────────────────────── */
export async function addMedia(path, url, size) {
  await mutate(async doc => { doc.media[path] = { url, size, uploaded_at: now() }; });
}
export async function removeMedia(path) {
  await mutate(async doc => { delete doc.media[path]; });
}

/* ── 전체 내보내기 (동기화·백업) ─────────────────────────────── */
export async function exportAll({ revisions = false } = {}) {
  const loaded = await loadDoc();
  const bodies = await loadBodies(Object.keys(loaded.doc.posts));
  return { ver: loaded.ver, doc: loaded.doc, bodies, ...(revisions ? { revisions: await loadRevisions(500) } : {}) };
}

/* ── 최초 이전: 없는 항목만 추가 (기존 데이터는 절대 덮어쓰지 않음) ───── */
export async function seedMissing({ blocks = [], posts = [], gallery = [] }) {
  const summary = { blocks: 0, posts: 0, gallery: 0, skippedGallery: false };
  const cleanBlocks = blocks.map(b => ({ ...clean('content_blocks', b, { insert: true }), ...clean('content_blocks', b) }));
  const cleanPosts = posts.map(p => clean('posts', p, { insert: true }));
  const cleanGallery = gallery.map(g => clean('gallery_items', g, { insert: true }));
  const { result } = await mutate(async (doc, tx) => {
    const stamp = now();
    const base = { version: 1, created_at: stamp, updated_at: stamp, updated_by: 'seed' };
    const s = { blocks: 0, posts: 0, gallery: 0, skippedGallery: false };
    for (const b of cleanBlocks) {
      if (doc.blocks[b.key]) continue;
      doc.blocks[b.key] = { ...DEFAULTS.content_blocks, ...b, ...base };
      s.blocks++;
    }
    const slugs = new Set(Object.values(doc.posts).map(p => p.slug));
    for (const p of cleanPosts) {
      if (slugs.has(p.slug)) continue;
      const id = randomUUID();
      const { rest, bodies } = splitBodies({ ...DEFAULTS.posts, ...p });
      doc.posts[id] = { ...rest, id, ...base };
      tx.setBody(id, { body_html: bodies?.body_html || '', after_html: bodies?.after_html || '' });
      s.posts++;
    }
    if (Object.keys(doc.gallery).length === 0) {
      for (const g of cleanGallery) {
        const id = randomUUID();
        doc.gallery[id] = { ...DEFAULTS.gallery_items, ...g, id, ...base };
        s.gallery++;
      }
    } else s.skippedGallery = cleanGallery.length > 0;
    return s;
  });
  return Object.assign(summary, result);
}
