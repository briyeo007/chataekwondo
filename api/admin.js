// 관리자 API: /api/admin/<경로>  (vercel.json routes 에서 ?path= 로 연결)
// 로그인 관련 경로 외에는 모두 관장님 로그인 세션이 필요하다.
import { randomUUID } from 'node:crypto';
import { send, sendError, readJson, readBody, isSecure, checkSameOrigin, query } from './_lib/http.js';
import * as auth from './_lib/auth.js';
import {
  HttpError, listItems, getItem, insertItem, updateItem, deleteItem, loadRevisions, restoreRevision,
  addMedia, removeMedia, loadDoc,
} from './_lib/content.js';
import { kvConfigured } from './_lib/kv.js';
import { putMedia, deleteMedia, mediaConfigured } from './_lib/media.js';

const MAX_UPLOAD = 4.4 * 1024 * 1024; // Vercel 함수 요청 한도(4.5MB) 이내
const UPLOAD_FOLDERS = new Set(['gallery', 'posts', 'pages']);
const POST_LIST_FIELDS = ['id', 'slug', 'title', 'category', 'published_on', 'is_published', 'deleted_at', 'created_at', 'updated_at', 'cover_url', 'list_title', 'version', 'sort'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
const byDate = (a, b) => (b.published_on || '').localeCompare(a.published_on || '') || (a.sort ?? 0) - (b.sort ?? 0);

function newSlug() {
  const d = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  return `${d}-${randomUUID().slice(0, 4)}`;
}

/** 사진 파일이 다른 곳에서 쓰이지 않으면 저장소에서 삭제 */
async function deleteMediaIfUnused(path) {
  if (!path) return;
  const { doc } = await loadDoc();
  const entry = doc.media[path];
  if (!entry) return;
  const used = Object.values(doc.gallery).some(g => g.storage_path === path || g.src === entry.url)
    || Object.values(doc.posts).some(p => p.cover_url === entry.url || p.card_image_url === entry.url)
    || Object.values(doc.blocks).some(b => b.value === entry.url);
  if (used) return;
  await deleteMedia(entry.url);
  await removeMedia(path);
}

const PUBLIC = {
  'GET status': async () => ({ configured: kvConfigured() && mediaConfigured() && !!process.env.SESSION_SECRET }),
  'GET setup-check': async req => ({ valid: await auth.checkSetupToken(query(req).get('token')) }),
  'POST login': async (req, res) => {
    const b = await readJson(req);
    const cookie = await auth.login(b.username, b.password, b.remember, isSecure(req));
    res.setHeader('Set-Cookie', cookie);
    return { ok: true };
  },
  'POST logout': async (req, res) => { res.setHeader('Set-Cookie', auth.clearCookie(isSecure(req))); return { ok: true }; },
  'POST setup': async (req, res) => {
    const b = await readJson(req);
    const r = await auth.setupWithToken(b.token, b.password, isSecure(req));
    res.setHeader('Set-Cookie', r.cookie);
    return { recoveryCode: r.recoveryCode };
  },
  'POST recover': async (req, res) => {
    const b = await readJson(req);
    const r = await auth.recoverWithCode(b.username, b.code, b.password, isSecure(req));
    res.setHeader('Set-Cookie', r.cookie);
    return { recoveryCode: r.recoveryCode };
  },
};

const PRIVATE = {
  'GET me': async (req, a) => ({ username: a.username, last_login: a.last_login, password_set_at: a.password_set_at }),
  'POST password': async (req, a, res) => {
    const b = await readJson(req);
    const r = await auth.changePassword(a, b.current, b.next, isSecure(req));
    res.setHeader('Set-Cookie', r.cookie);
    return { recoveryCode: r.recoveryCode };
  },
  'POST recovery-code': async (req, a) => ({ recoveryCode: await auth.regenerateRecovery(a, (await readJson(req)).current) }),
  'POST logout-all': async (req, a, res) => { await auth.logoutAll(); res.setHeader('Set-Cookie', auth.clearCookie(isSecure(req))); return { ok: true }; },

  // 도장 소식
  'GET posts': async () => (await listItems('posts')).sort(byDate).map(p => pick(p, POST_LIST_FIELDS)),
  'GET post': async req => getItem('posts', query(req).get('id')),
  'POST post': async req => {
    const b = await readJson(req);
    return insertItem('posts', { ...b, slug: newSlug() });
  },
  'PATCH post': async req => { const b = await readJson(req); return updateItem('posts', b.id, b.version, b.patch); },
  'DELETE post': async req => { await deleteItem('posts', query(req).get('id')); return { ok: true }; },

  // 갤러리
  'GET gallery': async () => (await listItems('gallery_items')).sort((a, b) => a.pane.localeCompare(b.pane) || a.sort - b.sort || a.created_at.localeCompare(b.created_at)),
  'POST gallery': async req => {
    const { rows } = await readJson(req);
    if (!Array.isArray(rows) || rows.length > 50) throw new HttpError(400, 'invalid', '한 번에 50장까지 올릴 수 있습니다.');
    const out = [];
    for (const r of rows) out.push(await insertItem('gallery_items', r));
    return out;
  },
  'PATCH gallery': async req => { const b = await readJson(req); return updateItem('gallery_items', b.id, b.version, b.patch); },
  'DELETE gallery': async req => {
    const item = await deleteItem('gallery_items', query(req).get('id'));
    await deleteMediaIfUnused(item.storage_path);
    return { ok: true };
  },

  // 페이지 문구
  'GET blocks': async req => (await listItems('content_blocks')).filter(b => b.page === query(req).get('page')).sort((a, b) => a.sort - b.sort),
  'GET blocks-meta': async () => (await listItems('content_blocks')).map(b => pick(b, ['key', 'page', 'updated_at'])),
  'PATCH block': async req => { const b = await readJson(req); return updateItem('content_blocks', b.key, b.version, b.patch); },

  // 변경 기록
  'GET revisions': async req => loadRevisions(Math.min(500, Number(query(req).get('limit')) || 150)),
  'POST restore': async req => restoreRevision((await readJson(req)).id),

  // 사진 업로드 (브라우저에서 JPEG로 변환된 파일)
  'POST upload': async req => {
    const folder = query(req).get('folder');
    if (!UPLOAD_FOLDERS.has(folder)) throw new HttpError(400, 'invalid', '잘못된 업로드 위치');
    if (req.headers['content-type'] !== 'image/jpeg') throw new HttpError(415, 'invalid_mime', 'JPG 형식만 올릴 수 있습니다.');
    const buf = await readBody(req, MAX_UPLOAD);
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new HttpError(415, 'invalid_mime', '이미지 파일이 아닙니다.');
    const d = new Date();
    const path = `${folder}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.jpg`;
    const url = await putMedia(path, buf, 'image/jpeg');
    await addMedia(path, url, buf.length);
    return { url, path };
  },
};

export default async function handler(req, res) {
  const path = query(req).get('path') || '';
  const key = `${req.method} ${path}`;
  try {
    checkSameOrigin(req);
    if (PUBLIC[key]) return send(res, 200, await PUBLIC[key](req, res));
    if (PRIVATE[key]) {
      const a = await auth.requireSession(req);
      return send(res, 200, await PRIVATE[key](req, a, res));
    }
    throw new HttpError(404, 'not_found', '없는 요청입니다.');
  } catch (e) {
    return sendError(res, e);
  }
}
