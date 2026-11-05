// 방문자 페이지 렌더링 (vercel.json routes 에서 연결).
// 원본 HTML 파일을 템플릿으로 읽고, DB 콘텐츠를 지정된 영역에만 끼워 넣는다.
// 저장소 → content/ 파일(동기화 사본) → 원본 HTML 순으로 대체한다 → 사이트 무중단.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPage, getPost, configured } from './_lib/data.js';
import { applySlots } from './_lib/slots.js';
import { renderPost } from './_lib/post.js';
import { sanitize } from './_lib/sanitize.js';
import { newsCards, indexNewsCards, galleryItems, GALLERY_PANES } from './_lib/lists.js';

const ROOT = process.cwd();
const PAGES = new Set(['index', 'news', 'gallery', 'greeting', 'instructor', 'philosophy']);
const CACHE_OK = 'public, max-age=0, s-maxage=30, stale-while-revalidate=300';
const CACHE_FALLBACK = 'public, max-age=0, s-maxage=10';

const fileCache = new Map();
async function readTemplate(rel) {
  if (!fileCache.has(rel)) fileCache.set(rel, readFile(join(ROOT, rel), 'utf8'));
  try {
    return await fileCache.get(rel);
  } catch (e) {
    fileCache.delete(rel);
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function send(res, status, html, cache, mode) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-CMS', mode);
  res.end(html);
}

const NOT_FOUND = `<!DOCTYPE html><html lang="ko-KR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>페이지를 찾을 수 없습니다 – 차 태권도</title><link rel="icon" href="/logo-01.png"><meta name="robots" content="noindex"></head><body style="font-family:'Noto Sans KR',sans-serif;text-align:center;padding:96px 24px;color:#333;"><img src="/logo-01.png" alt="차 태권도" style="height:56px;margin-bottom:24px;"><h1 style="font-size:22px;margin-bottom:12px;">페이지를 찾을 수 없습니다</h1><p style="color:#777;margin-bottom:28px;">삭제되었거나 주소가 바뀐 페이지입니다.</p><a href="/news.html" style="display:inline-block;padding:12px 28px;background:#14171c;color:#fff;border-radius:30px;text-decoration:none;font-weight:700;">도장 소식 보기</a></body></html>`;

function buildLists(page, data) {
  const lists = {};
  if (page === 'news') lists.news = newsCards(data.posts || []);
  if (page === 'index') lists['index-news'] = indexNewsCards(data.posts || []);
  if (page === 'gallery') {
    for (const pane of GALLERY_PANES) {
      lists[`gallery:${pane}`] = galleryItems((data.gallery || []).filter(g => g.pane === pane), pane);
    }
  }
  return lists;
}

async function renderPage(page, res) {
  const tpl = await readTemplate(`${page}.html`);
  if (!configured()) return send(res, 200, tpl, CACHE_OK, 'static');
  let data;
  try {
    data = await getPage(page);
  } catch (e) {
    console.error('[cms] getPage failed', page, e.message);
  }
  if (!data) return send(res, 200, tpl, CACHE_FALLBACK, 'fallback');
  const blocks = new Map((data.blocks || []).map(b => [b.key, b]));
  const out = applySlots(tpl, blocks, buildLists(page, data), sanitize);
  return send(res, 200, out, CACHE_OK, data.source || 'db');
}

async function renderPostPage(slug, res) {
  const file = await readTemplate(`post-${slug}.html`);
  if (!configured()) {
    return file ? send(res, 200, file, CACHE_OK, 'static') : send(res, 404, NOT_FOUND, CACHE_FALLBACK, 'static');
  }
  let result;
  try {
    result = await getPost(slug);
  } catch (e) {
    console.error('[cms] getPost failed', slug, e.message);
  }
  if (!result) {
    return file ? send(res, 200, file, CACHE_FALLBACK, 'fallback') : send(res, 404, NOT_FOUND, CACHE_FALLBACK, 'fallback');
  }
  const mode = result.source || 'db';
  if (result.status === 'hidden') return send(res, 404, NOT_FOUND, CACHE_OK, mode);
  if (result.status === 'none') {
    // DB에 없는 글: 파일이 있으면 그대로(예: post-register-form.html)
    return file ? send(res, 200, file, CACHE_OK, 'static') : send(res, 404, NOT_FOUND, CACHE_OK, mode);
  }
  const tpl = file || (await readTemplate('api/_lib/post-template.html'));
  return send(res, 200, renderPost(tpl, result.post, sanitize), CACHE_OK, mode);
}

export default async function handler(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const page = q.get('page');
  const post = q.get('post');
  try {
    if (page && PAGES.has(page)) return await renderPage(page, res);
    if (post && /^[a-z0-9][a-z0-9-]{0,80}$/.test(post)) return await renderPostPage(post, res);
    return send(res, 404, NOT_FOUND, CACHE_FALLBACK, 'none');
  } catch (e) {
    // 예기치 못한 오류: 가능하면 원본 파일로 응답
    console.error('[cms] render error', e);
    const fallback = page && PAGES.has(page) ? await readTemplate(`${page}.html`).catch(() => null)
      : post ? await readTemplate(`post-${post}.html`).catch(() => null) : null;
    if (fallback) return send(res, 200, fallback, CACHE_FALLBACK, 'error-fallback');
    return send(res, 500, NOT_FOUND, 'no-store', 'error');
  }
}
