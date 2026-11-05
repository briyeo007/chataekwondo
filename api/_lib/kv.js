// 키-값 저장소.
//   운영: Supabase 데이터베이스 (테이블·함수는 supabase/schema.sql, 환경변수 SUPABASE_URL / SUPABASE_SECRET_KEY)
//   로컬 테스트: CMS_STORE_DIR 폴더의 JSON 파일 (npm run dev 에서 자동 사용)
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseHeaders } from './supabase.js';

const DOC = 'cms:doc';
const VER = 'cms:ver';
const REVS = 'cms:revisions';
const MAX_REVS = 500;

/* ── Supabase (REST API 직접 호출, 서버 secret 키 전용) ──────────────── */
// CMS_KEY_PREFIX: 운영 저장소에서 시험할 때 운영 키와 겹치지 않도록 모든 키 앞에 붙임 (운영에서는 비워 둠)
function supabaseBackend(url, key, prefix = '') {
  const base = url.replace(/\/+$/, '') + '/rest/v1';
  const p = k => prefix + k;
  const enc = encodeURIComponent;
  const quote = v => `"${String(v).replace(/["\\]/g, '\\$&')}"`; // in.(…) 목록 값
  const live = row => (row && (!row.expires_at || Date.parse(row.expires_at) > Date.now()) ? row.value : null);

  async function call(method, path, body, prefer) {
    const res = await fetch(base + path, {
      method,
      headers: supabaseHeaders(key, { 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    name: 'supabase',
    async get(k) {
      return live((await call('GET', `/cms_kv?select=value,expires_at&key=eq.${enc(p(k))}`))[0]);
    },
    async mget(keys) {
      const out = new Map();
      for (let i = 0; i < keys.length; i += 100) {
        const chunk = keys.slice(i, i + 100).map(p);
        const rows = await call('GET', `/cms_kv?select=key,value,expires_at&key=in.(${enc(chunk.map(quote).join(','))})`);
        for (const r of rows) out.set(r.key, live(r));
      }
      return keys.map(k => out.get(p(k)) ?? null);
    },
    set(k, v, ttl) {
      const expires_at = ttl ? new Date(Date.now() + ttl * 1000).toISOString() : null;
      return call('POST', '/cms_kv', { key: p(k), value: v, expires_at }, 'resolution=merge-duplicates,return=minimal');
    },
    del(k) { return call('DELETE', `/cms_kv?key=eq.${enc(p(k))}`, undefined, 'return=minimal'); },
    async lrange(k, a, b) {
      const limit = b < 0 ? '' : `&limit=${b - a + 1}`;
      return (await call('GET', `/cms_revisions?select=value&list_key=eq.${enc(p(k))}&order=id.desc&offset=${a}${limit}`)).map(r => r.value);
    },
    // 글 데이터 문서 교체를 "버전이 같을 때만" 원자적으로 처리 (supabase/schema.sql 의 cms_cas 함수)
    async casDoc({ expectVer, doc, sets = {}, dels = [], revisions = [] }) {
      const nv = await call('POST', '/rpc/cms_cas', {
        p_ver_key: p(VER), p_doc_key: p(DOC), p_rev_key: p(REVS), p_expect: String(expectVer), p_doc: doc,
        p_sets: Object.fromEntries(Object.entries(sets).map(([k, v]) => [p(k), v])),
        p_dels: dels.map(p), p_revs: revisions, p_max_revs: MAX_REVS,
      });
      return Number(nv) < 0 ? null : Number(nv);
    },
  };
}

/* ── 로컬 파일 (개발·테스트 전용, 단일 프로세스) ──────────────────── */
function fileBackend(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'kv.json');
  const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
  const save = data => { writeFileSync(file + '.tmp', JSON.stringify(data)); renameSync(file + '.tmp', file); };
  const live = (data, k) => {
    const e = data[k];
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) { delete data[k]; return null; }
    return e.v;
  };
  return {
    name: 'file',
    async get(k) { return live(load(), k); },
    async mget(keys) { const d = load(); return keys.map(k => live(d, k)); },
    async set(k, v, ttl) { const d = load(); d[k] = { v, exp: ttl ? Date.now() + ttl * 1000 : 0 }; save(d); },
    async del(k) { const d = load(); delete d[k]; save(d); },
    async lrange(k, a, b) { const list = live(load(), k) || []; return list.slice(a, b < 0 ? undefined : b + 1); },
    async casDoc({ expectVer, doc, sets = {}, dels = [], revisions = [] }) {
      const d = load();
      const cur = live(d, VER) || '0';
      if (cur !== String(expectVer)) return null;
      const nv = Number(cur) + 1;
      d[DOC] = { v: doc, exp: 0 };
      d[VER] = { v: String(nv), exp: 0 };
      for (const [k, v] of Object.entries(sets)) d[k] = { v, exp: 0 };
      for (const k of dels) delete d[k];
      if (revisions.length) {
        const list = live(d, REVS) || [];
        d[REVS] = { v: [...[...revisions].reverse(), ...list].slice(0, MAX_REVS), exp: 0 };
      }
      save(d);
      return nv;
    },
  };
}

let cached = null;
/** 저장소가 설정되지 않았으면 null */
export async function kv() {
  if (cached) return cached;
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
  if (url && key) cached = supabaseBackend(url, key, process.env.CMS_KEY_PREFIX || '');
  else if (process.env.CMS_STORE_DIR) cached = fileBackend(process.env.CMS_STORE_DIR);
  return cached;
}

export function kvConfigured() {
  return !!((process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) || process.env.CMS_STORE_DIR);
}

export const KEYS = { DOC, VER, REVS };
