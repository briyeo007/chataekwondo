// 개발자 명령 공통: 환경변수 로드와 동기화 API(/api/sync/*) 호출.
// 기본 설정 파일: .env.local  (다른 파일: --env <파일>, 예: 로컬 테스트 서버는 --env .cms/dev.env)
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ROOT } from './extract.mjs';

export const args = process.argv.slice(2);
export const flag = name => args.includes(`--${name}`);
export const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const VALUED = new Set(['--env', '--out']);
export const positional = () => args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1]));

export function loadEnv() {
  const name = option('env') || '.env.local';
  const file = isAbsolute(name) ? name : join(ROOT, name);
  if (!existsSync(file)) {
    console.error(`✗ 설정 파일이 없습니다: ${file}\n  .env.example 을 .env.local 로 복사해서 값을 채워 주세요.`);
    process.exit(1);
  }
  process.loadEnvFile(file);
  for (const k of ['CMS_SITE_URL', 'CMS_SYNC_TOKEN']) {
    if (!process.env[k]) { console.error(`✗ ${file} 에 ${k} 가 없습니다.`); process.exit(1); }
  }
  process.env.CMS_SITE_URL = process.env.CMS_SITE_URL.replace(/\/+$/, '');
  return process.env.CMS_SITE_URL;
}

export class RemoteError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function api(method, path, body, { raw = false, contentType } = {}) {
  let res;
  try {
    res = await fetch(`${process.env.CMS_SITE_URL}/api/sync/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.CMS_SYNC_TOKEN}`,
        ...(body !== undefined ? { 'Content-Type': contentType || 'application/json' } : {}),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new RemoteError(0, 'network', `홈페이지 서버에 연결할 수 없습니다 (${process.env.CMS_SITE_URL}): ${e.cause?.code || e.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new RemoteError(res.status, data.error, data.message || `요청 실패 (${res.status})`);
  return data;
}

/** 사진 주소 → 내려받기 (로컬 테스트 서버의 /cms-media/ 상대 주소 포함) */
export async function download(url) {
  const abs = url.startsWith('/') ? process.env.CMS_SITE_URL + url : url;
  const res = await fetch(abs, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`다운로드 실패 ${res.status}: ${abs}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function confirm(question) {
  if (flag('yes')) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(`${question} (${process.env.CMS_SITE_URL}) 계속할까요? (y/N) `);
  rl.close();
  return /^y(es)?$/i.test(ans.trim());
}

export function fail(e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
