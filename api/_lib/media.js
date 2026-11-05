// 사진 파일 저장소.
//   운영: Supabase Storage (버킷은 supabase/schema.sql)
//         cms-media   — 홈페이지 사진 (공개 읽기)
//         cms-backups — backups/ 로 시작하는 파일 (비공개, 내려받을 때 1시간짜리 서명 주소 발급)
//   로컬 테스트: CMS_STORE_DIR/media 폴더 (주소 /cms-media/...)
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { supabaseHeaders } from './supabase.js';

const LOCAL_PREFIX = '/cms-media/';
const MEDIA_BUCKET = 'cms-media';
const BACKUP_BUCKET = 'cms-backups';
// CMS_MEDIA_PREFIX: 운영 저장소에서 시험할 때 파일을 별도 폴더에 둠 (운영에서는 비워 둠)
const storePath = path => (process.env.CMS_MEDIA_PREFIX || '') + path;
const bucketFor = path => (path.startsWith('backups/') ? BACKUP_BUCKET : MEDIA_BUCKET);
const encPath = path => path.split('/').map(encodeURIComponent).join('/');

const supabase = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const storageUrl = () => process.env.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1';

async function storage(method, path, body, headers = {}) {
  const res = await fetch(storageUrl() + path, {
    method,
    headers: supabaseHeaders(process.env.SUPABASE_SECRET_KEY, headers),
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase Storage ${method} ${path.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const json = { 'Content-Type': 'application/json' };

export function mediaConfigured() {
  return supabase() || !!process.env.CMS_STORE_DIR;
}

/** @returns {Promise<string>} 공개 주소 */
export async function putMedia(path, buffer, contentType, { overwrite = false } = {}) {
  if (supabase()) {
    const bucket = bucketFor(path);
    const full = encPath(storePath(path));
    await storage('POST', `/object/${bucket}/${full}`, buffer, {
      'Content-Type': contentType,
      'x-upsert': String(overwrite),
      'cache-control': `max-age=${bucket === BACKUP_BUCKET ? 60 : 31536000}`,
    });
    return bucket === MEDIA_BUCKET ? `${storageUrl()}/object/public/${bucket}/${full}` : `${storageUrl()}/object/${bucket}/${full}`;
  }
  const file = join(process.env.CMS_STORE_DIR, 'media', path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buffer);
  return LOCAL_PREFIX + path;
}

export async function deleteMedia(urlOrPath) {
  if (supabase()) {
    // 공개 주소 / 서명 주소 / 내부 주소 모두에서 버킷과 파일 경로를 꺼냄
    const m = String(urlOrPath).match(/\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/?]+)\/([^?]+)/);
    if (!m) throw new Error(`삭제할 수 없는 주소: ${urlOrPath}`);
    await storage('DELETE', `/object/${m[1]}`, JSON.stringify({ prefixes: [decodeURIComponent(m[2])] }), json);
    return;
  }
  const path = String(urlOrPath).replace(LOCAL_PREFIX, '');
  rmSync(join(process.env.CMS_STORE_DIR, 'media', path), { force: true });
}

/** 폴더(예: 'backups/') 안의 파일 목록 → [{ pathname, url, uploadedAt }] */
export async function listMedia(prefix) {
  if (supabase()) {
    const bucket = bucketFor(prefix);
    const folder = storePath(prefix).replace(/\/+$/, '');
    const files = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await storage('POST', `/object/list/${bucket}`, JSON.stringify({ prefix: folder, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }), json);
      files.push(...page.filter(f => f.id)); // id 없는 항목은 하위 폴더
      if (page.length < 1000) break;
    }
    if (!files.length) return [];
    const paths = files.map(f => `${folder}/${f.name}`);
    let urls;
    if (bucket === MEDIA_BUCKET) urls = paths.map(p => `${storageUrl()}/object/public/${bucket}/${encPath(p)}`);
    else {
      const signed = await storage('POST', `/object/sign/${bucket}`, JSON.stringify({ expiresIn: 3600, paths }), json);
      urls = signed.map(s => storageUrl() + s.signedURL);
    }
    return files.map((f, i) => ({ pathname: prefix + f.name, url: urls[i], uploadedAt: f.updated_at || f.created_at }));
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
