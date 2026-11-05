// API 공통: 요청 본문 읽기, JSON 응답, 오류 처리, 요청 출처 검사
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './content.js';

export async function readBody(req, limit = 1024 * 1024) {
  if (req.readableEnded && req.body !== undefined) {
    return Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'too_large', '요청이 너무 큽니다.');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'bad_json', '요청 형식 오류'); }
}

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export function sendError(res, e) {
  if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
  console.error('[cms api]', e);
  return send(res, 500, { error: 'server_error', message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
}

/** HTTPS 여부 (쿠키 Secure 속성) */
export function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host || ''));
}

/** 쓰기 요청은 같은 사이트에서 보낸 것만 허용 (CSRF 방지) */
export function checkSameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-cms'] !== '1') throw new HttpError(403, 'forbidden', '허용되지 않은 요청입니다.');
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = ''; }
    if (host !== req.headers.host && host !== req.headers['x-forwarded-host']) throw new HttpError(403, 'forbidden', '허용되지 않은 요청입니다.');
  }
}

/** 개발자 동기화 토큰 검사 */
export function requireSyncToken(req) {
  const expected = process.env.CMS_SYNC_TOKEN;
  if (!expected || expected.length < 32) throw new HttpError(503, 'not_configured', 'CMS_SYNC_TOKEN 설정이 필요합니다.');
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const cron = process.env.CRON_SECRET;
  const ok = (v) => v && got.length === v.length && timingSafeEqual(Buffer.from(got), Buffer.from(v));
  if (!ok(expected) && !ok(cron)) throw new HttpError(401, 'unauthorized', '토큰이 올바르지 않습니다.');
  return ok(expected) ? 'developer' : 'cron';
}

export function query(req) {
  return new URL(req.url, 'http://x').searchParams;
}
