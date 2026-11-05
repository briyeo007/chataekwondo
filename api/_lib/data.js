// 방문자 페이지 렌더링용 콘텐츠 조회.
// 우선순위: ① 저장소(Supabase / 로컬 테스트 저장소) → ② 배포에 포함된 content/ 파일(내 PC가 동기화한 사본)
//          → ③ 둘 다 없으면 null (호출 측이 원본 HTML 그대로 표시)
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadDoc, loadBodies } from './content.js';
import { kvConfigured } from './kv.js';

const DOC_TTL_MS = Number(process.env.CMS_DOC_CACHE_MS ?? 5000); // 같은 서버 인스턴스에서 5초간 재사용
let docCache = null;

const contentDir = () => process.env.CMS_CONTENT_DIR || join(process.cwd(), 'content');
const visible = p => p.is_published !== false && !p.deleted_at;
const byDate = (a, b) => (b.published_on || '').localeCompare(a.published_on || '') || (a.sort ?? 0) - (b.sort ?? 0);
const LIST_FIELDS = ['slug', 'title', 'category', 'published_on', 'excerpt', 'cover_url', 'cover_alt', 'list_title', 'list_category', 'card_image_url', 'card_image_alt'];

/* ── 데이터 원천 ─────────────────────────────────────────────── */
// 공통 형식: { blocks: [], posts: [] (본문 포함 가능), gallery: [], bodies?: (id)=>Promise }

async function fromStore() {
  if (!kvConfigured()) return null;
  if (docCache && Date.now() - docCache.at < DOC_TTL_MS) return docCache.data;
  const loaded = await loadDoc();
  if (!loaded || loaded.ver === 0) return null; // 아직 이전 전
  const { doc } = loaded;
  const data = {
    source: 'db',
    blocks: Object.values(doc.blocks),
    posts: Object.values(doc.posts),
    gallery: Object.values(doc.gallery),
    async body(post) { return (await loadBodies([post.id]))[post.id]; },
  };
  docCache = { at: Date.now(), data };
  return data;
}

let filesCache = null;
async function fromFiles() {
  if (filesCache) return filesCache;
  // 테스트용 단일 JSON
  if (process.env.CMS_LOCAL_DATA) {
    const db = JSON.parse(await readFile(process.env.CMS_LOCAL_DATA, 'utf8'));
    return (filesCache = { source: 'db', ...db, async body(p) { return { body_html: p.body_html, after_html: p.after_html }; } });
  }
  // 동기화된 content/ 폴더
  const dir = contentDir();
  if (!existsSync(join(dir, 'blocks.json'))) return null;
  const read = async f => JSON.parse(await readFile(join(dir, f), 'utf8'));
  const posts = [];
  if (existsSync(join(dir, 'posts'))) {
    for (const f of (await readdir(join(dir, 'posts'))).filter(f => f.endsWith('.json'))) {
      const slug = f.replace(/\.json$/, '');
      const p = await read(join('posts', f));
      posts.push({ ...p, slug });
    }
  }
  filesCache = {
    source: 'content-files',
    blocks: await read('blocks.json'),
    posts,
    gallery: existsSync(join(dir, 'gallery.json')) ? await read('gallery.json') : [],
    async body(p) {
      const rd = async ext => { const f = join(dir, 'posts', `${p.slug}.${ext}.html`); return existsSync(f) ? readFile(f, 'utf8') : ''; };
      return { body_html: await rd('body'), after_html: await rd('after') };
    },
  };
  return filesCache;
}

async function source() {
  try {
    const s = await fromStore();
    if (s) return s;
  } catch (e) {
    console.error('[cms] 저장소 조회 실패 → content 파일 사용', e.message);
  }
  return fromFiles();
}

/* ── 공개 함수 ─────────────────────────────────────────────── */

/** 페이지 데이터: { source, blocks, posts, gallery } 또는 null */
export async function getPage(page) {
  const s = await source();
  if (!s) return null;
  const pick = p => Object.fromEntries(LIST_FIELDS.map(k => [k, p[k]]));
  return {
    source: s.source,
    blocks: s.blocks.filter(b => b.page === page),
    posts: page === 'index' || page === 'news' ? s.posts.filter(visible).sort(byDate).slice(0, page === 'index' ? 6 : 500).map(pick) : [],
    gallery: page === 'gallery'
      ? s.gallery.filter(g => !g.deleted_at).sort((a, b) => a.pane.localeCompare(b.pane) || a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at)))
      : [],
  };
}

/** 글 데이터: { source, status: 'ok'|'hidden'|'none', post? } 또는 null */
export async function getPost(slug) {
  const s = await source();
  if (!s) return null;
  const p = s.posts.find(x => x.slug === slug);
  if (!p) return { source: s.source, status: 'none' };
  if (!visible(p)) return { source: s.source, status: 'hidden' };
  return { source: s.source, status: 'ok', post: { ...p, ...(await s.body(p)) } };
}

export function configured() {
  return kvConfigured() || !!process.env.CMS_LOCAL_DATA || existsSync(join(contentDir(), 'blocks.json'));
}

/** 테스트용 캐시 비우기 */
export function resetLocalCache() { filesCache = null; docCache = null; }
