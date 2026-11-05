// 키-값 저장소.
//   운영: Upstash Redis (Vercel Marketplace → 환경변수 KV_REST_API_URL / KV_REST_API_TOKEN 자동 설정)
//   로컬 테스트: CMS_STORE_DIR 폴더의 JSON 파일 (npm run dev 에서 자동 사용)
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const DOC = 'cms:doc';
const VER = 'cms:ver';
const REVS = 'cms:revisions';
const MAX_REVS = 500;

/* ── Upstash Redis ─────────────────────────────────────────── */
// 글 데이터 문서 교체를 "버전이 같을 때만" 원자적으로 처리하는 스크립트
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1]) or '0'
if cur ~= ARGV[1] then return -1 end
local nv = tonumber(cur) + 1
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[1], tostring(nv))
local ns = tonumber(ARGV[3])
local nd = tonumber(ARGV[4])
local nr = tonumber(ARGV[5])
for i = 1, ns do redis.call('SET', KEYS[3 + i], ARGV[5 + i]) end
for i = 1, nd do redis.call('DEL', KEYS[3 + ns + i]) end
for i = 1, nr do redis.call('LPUSH', KEYS[3], ARGV[5 + ns + i]) end
if nr > 0 then redis.call('LTRIM', KEYS[3], 0, ${MAX_REVS - 1}) end
return nv
`;

async function redisBackend(url, token) {
  const { Redis } = await import('@upstash/redis');
  const r = new Redis({ url, token, automaticDeserialization: false });
  return {
    name: 'redis',
    get: k => r.get(k),
    mget: keys => (keys.length ? r.mget(...keys) : []),
    set: (k, v, ttl) => (ttl ? r.set(k, v, { ex: ttl }) : r.set(k, v)),
    del: k => r.del(k),
    lrange: (k, a, b) => r.lrange(k, a, b),
    async casDoc({ expectVer, doc, sets = {}, dels = [], revisions = [] }) {
      const setKeys = Object.keys(sets);
      const keys = [VER, DOC, REVS, ...setKeys, ...dels];
      const args = [String(expectVer), doc, String(setKeys.length), String(dels.length), String(revisions.length),
        ...setKeys.map(k => sets[k]), ...revisions];
      const nv = await r.eval(CAS_SCRIPT, keys, args);
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
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) cached = await redisBackend(url, token);
  else if (process.env.CMS_STORE_DIR) cached = fileBackend(process.env.CMS_STORE_DIR);
  return cached;
}

export function kvConfigured() {
  return !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) || process.env.CMS_STORE_DIR);
}

export const KEYS = { DOC, VER, REVS };
