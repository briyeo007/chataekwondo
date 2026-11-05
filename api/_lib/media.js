// 사진 파일 저장소.
//   운영: Vercel Blob (Vercel → Storage → Blob 연결 시 BLOB_READ_WRITE_TOKEN 자동 설정)
//   로컬 테스트: CMS_STORE_DIR/media 폴더 (주소 /cms-media/...)
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const LOCAL_PREFIX = '/cms-media/';
// CMS_MEDIA_PREFIX: 운영 Blob 에서 시험할 때 파일을 별도 폴더에 둠 (운영에서는 비워 둠)
const blobPath = path => (process.env.CMS_MEDIA_PREFIX || '') + path;

export function mediaConfigured() {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.CMS_STORE_DIR);
}

/** @returns {Promise<string>} 공개 주소 */
export async function putMedia(path, buffer, contentType, { overwrite = false } = {}) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const r = await put(blobPath(path), buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: overwrite,
      cacheControlMaxAge: path.startsWith('backups/') ? 60 : 31536000,
    });
    return r.url;
  }
  const file = join(process.env.CMS_STORE_DIR, 'media', path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buffer);
  return LOCAL_PREFIX + path;
}

export async function deleteMedia(urlOrPath) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { del } = await import('@vercel/blob');
    await del(urlOrPath);
    return;
  }
  const path = String(urlOrPath).replace(LOCAL_PREFIX, '');
  rmSync(join(process.env.CMS_STORE_DIR, 'media', path), { force: true });
}

/** 접두사로 파일 목록 → [{ pathname, url, uploadedAt }] */
export async function listMedia(prefix) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { list } = await import('@vercel/blob');
    const out = [];
    let cursor;
    do {
      const r = await list({ prefix: blobPath(prefix), cursor, limit: 1000 });
      const cut = blobPath('').length;
      out.push(...r.blobs.map(b => ({ pathname: b.pathname.slice(cut), url: b.url, uploadedAt: b.uploadedAt })));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out;
  }
  const { readdirSync, statSync } = await import('node:fs');
  const base = join(process.env.CMS_STORE_DIR, 'media');
  const dir = join(base, prefix);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map(n => ({ pathname: prefix + n, url: LOCAL_PREFIX + prefix + n, uploadedAt: statSync(join(dir, n)).mtime }));
}

/** 로컬 저장소 파일 읽기 (개발 서버의 /cms-media/ 제공용) */
export function readLocalMedia(path) {
  const file = join(process.env.CMS_STORE_DIR || '', 'media', path);
  if (!process.env.CMS_STORE_DIR || path.includes('..') || !existsSync(file)) return null;
  return readFileSync(file);
}
