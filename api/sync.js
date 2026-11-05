// 개발자 동기화 API: /api/sync/<경로>  (Authorization: Bearer CMS_SYNC_TOKEN)
// 내 PC의 동기화 프로그램과 개발자 명령(npm run cms:*, admin:*)이 사용한다.
import { createCipheriv, randomBytes, createHash } from 'node:crypto';
import { send, sendError, readJson, readBody, requireSyncToken, query } from './_lib/http.js';
import {
  HttpError, exportAll, seedMissing, insertItem, updateItem, loadDoc, addMedia, TABLES,
} from './_lib/content.js';
import * as auth from './_lib/auth.js';
import { putMedia, listMedia, deleteMedia } from './_lib/media.js';

const BACKUP_KEEP_DAYS = 30;

/** 백업 암호화 (AES-256-GCM). 키: BACKUP_KEY 환경변수 */
function encrypt(buf) {
  const secret = process.env.BACKUP_KEY;
  if (!secret || secret.length < 32) throw new HttpError(503, 'not_configured', 'BACKUP_KEY 설정이 필요합니다.');
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from('CMSB1'), iv, c.getAuthTag(), enc]);
}

const ROUTES = {
  // 변경분 받기: 버전이 같으면 unchanged
  'GET pull': async req => {
    const since = Number(query(req).get('since') || -1);
    const { ver } = await loadDoc();
    if (ver === since) return { ver, unchanged: true };
    return exportAll();
  },

  // 내 PC에서 수정한 콘텐츠 올리기 (항목별 버전 확인, 충돌 시 반영 안 함)
  'POST push': async req => {
    const { changes } = await readJson(req, 4 * 1024 * 1024);
    if (!Array.isArray(changes)) throw new HttpError(400, 'invalid', 'changes 배열 필요');
    const results = [];
    for (const c of changes) {
      try {
        if (!TABLES[c.table]) throw new HttpError(400, 'invalid', '알 수 없는 종류');
        const item = c.version == null
          ? await insertItem(c.table, c.data, { id: c.id, actor: c.actor === 'restore' ? 'restore' : 'developer' })
          : await updateItem(c.table, c.key, c.version, c.data, { actor: c.actor === 'restore' ? 'restore' : 'developer' });
        results.push({ ref: c.ref, ok: true, item });
      } catch (e) {
        results.push({ ref: c.ref, ok: false, error: e.code || 'error', message: e.message });
      }
    }
    return { results };
  },

  // 사진 파일 올리기 (복구·로컬 사진 추가용)
  'POST upload': async req => {
    const path = query(req).get('path') || '';
    if (!/^(gallery|posts|pages)\/[\w/.-]+\.(jpg|jpeg|png|webp)$/i.test(path) || path.includes('..')) throw new HttpError(400, 'invalid', '잘못된 경로');
    const type = req.headers['content-type'];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new HttpError(415, 'invalid_mime', '지원하지 않는 형식');
    const buf = await readBody(req, 4.4 * 1024 * 1024);
    const url = await putMedia(path, buf, type, { overwrite: true });
    await addMedia(path, url, buf.length);
    return { url, path };
  },

  // 최초 이전 (없는 것만 추가)
  'POST seed': async req => seedMissing(await readJson(req, 4 * 1024 * 1024)),

  // 전체 백업 (변경 기록 포함)
  'GET backup': async () => exportAll({ revisions: true }),

  // 관장님 계정
  'POST admin-link': async () => ({ token: await auth.createSetupToken() }),
  'GET admin-status': async () => auth.authStatus(),
  'POST admin-unlock': async () => { await auth.unlock(); return { ok: true }; },
  'POST admin-logout-all': async () => { await auth.logoutAll(); return { ok: true }; },

  // 매일 자동 백업 (Vercel Cron) → Blob 에 암호화 저장, 30일 보관
  'GET cron-backup': async () => {
    const data = Buffer.from(JSON.stringify(await exportAll({ revisions: true })));
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    await putMedia(`backups/${day}.json.enc`, encrypt(data), 'application/octet-stream', { overwrite: true });
    const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400e3;
    const old = (await listMedia('backups/')).filter(b => new Date(b.uploadedAt).getTime() < cutoff);
    for (const b of old) await deleteMedia(b.url);
    return { ok: true, saved: day, removed: old.length };
  },
  'GET backups': async () => listMedia('backups/'),
};

export default async function handler(req, res) {
  const path = query(req).get('path') || '';
  try {
    const role = requireSyncToken(req);
    if (role === 'cron' && path !== 'cron-backup') throw new HttpError(403, 'forbidden', '허용되지 않은 요청');
    const route = ROUTES[`${req.method} ${path}`];
    if (!route) throw new HttpError(404, 'not_found', '없는 요청입니다.');
    return send(res, 200, await route(req));
  } catch (e) {
    return sendError(res, e);
  }
}
