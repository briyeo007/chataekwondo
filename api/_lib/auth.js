// 관장님 관리자 인증 (아이디 master + 비밀번호).
// * 비밀번호·복구 코드는 scrypt 해시로만 저장 (원문은 어디에도 남지 않음, 개발자도 알 수 없음)
// * 세션: 서명된 HttpOnly 쿠키. 비밀번호 변경·"모든 기기 로그아웃" 시 session_ver 증가 → 기존 세션 모두 무효
// * 로그인 5회 실패 → 15분 잠금 (서버에 기록)
// * 최초 설정·분실 시: 개발자가 발급한 일회용 링크(24시간) 또는 관장님의 복구 코드
import { scrypt as _scrypt, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { kv } from './kv.js';
import { HttpError } from './content.js';

const scrypt = promisify(_scrypt);
const AUTH_KEY = 'cms:auth';
const SETUP_PREFIX = 'cms:setup:';
const COOKIE = 'cms_session';
const MAX_FAIL = 5;
const LOCK_MS = 15 * 60 * 1000;
const SESSION_SHORT = 12 * 3600;      // 로그인 유지 안 함: 12시간
const SESSION_LONG = 30 * 24 * 3600;  // 로그인 유지: 30일
export const USERNAME = 'master';

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new HttpError(503, 'not_configured', '관리자 시스템 설정이 필요합니다 (SESSION_SECRET).');
  return s;
}

/* ── 해시 ─────────────────────────────────────────────── */
const N = 16384, R = 8, P = 1, LEN = 64;
export async function hashSecret(plain) {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifySecret(plain, stored) {
  if (!stored) { await scrypt(plain, 'dummy-salt', LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }); return false; }
  const [, n, r, p, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(plain, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(got, expected);
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return '비밀번호는 10자 이상이어야 합니다.';
  if (pw.length > 200) return '비밀번호가 너무 깁니다.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 모두 포함해 주세요.';
  if (pw.toLowerCase().includes(USERNAME)) return '아이디가 들어간 비밀번호는 사용할 수 없습니다.';
  return null;
}

function newRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O/1/I 제외
  const bytes = randomBytes(20);
  const chars = [...bytes].map(b => alphabet[b % alphabet.length]).join('');
  return chars.match(/.{5}/g).join('-'); // XXXXX-XXXXX-XXXXX-XXXXX
}
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{5})(?=.)/g, '$1-');

/* ── 계정 기록 ─────────────────────────────────────────── */
async function loadAuth() {
  const raw = await (await kv()).get(AUTH_KEY);
  return raw ? JSON.parse(raw) : { username: USERNAME, hash: null, recovery_hash: null, session_ver: 1, fail: 0, lock_until: 0 };
}
async function saveAuth(a) { await (await kv()).set(AUTH_KEY, JSON.stringify(a)); }

export async function authStatus() {
  const a = await loadAuth();
  return {
    username: a.username, password_set: !!a.hash, password_set_at: a.password_set_at || null,
    last_login: a.last_login || null, locked: a.lock_until > Date.now(), lock_until: a.lock_until || 0, fail: a.fail || 0,
  };
}

/* ── 세션 쿠키 ─────────────────────────────────────────── */
const b64u = s => Buffer.from(s).toString('base64url');
const sign = data => createHmac('sha256', secret()).update(data).digest('base64url');

function makeCookie(a, remember, secure) {
  const exp = Math.floor(Date.now() / 1000) + (remember ? SESSION_LONG : SESSION_SHORT);
  const payload = b64u(JSON.stringify({ u: a.username, v: a.session_ver, exp }));
  const value = `${payload}.${sign(payload)}`;
  return [
    `${COOKIE}=${value}`, 'Path=/api/admin', 'HttpOnly', 'SameSite=Strict',
    secure ? 'Secure' : '', remember ? `Max-Age=${SESSION_LONG}` : '',
  ].filter(Boolean).join('; ');
}
export function clearCookie(secure) {
  return [`${COOKIE}=`, 'Path=/api/admin', 'HttpOnly', 'SameSite=Strict', secure ? 'Secure' : '', 'Max-Age=0'].filter(Boolean).join('; ');
}

function readCookie(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

/** 로그인된 세션이면 계정 정보, 아니면 401 */
export async function requireSession(req) {
  const raw = readCookie(req);
  if (!raw) throw new HttpError(401, 'unauthorized', '로그인이 필요합니다.');
  const [payload, sig] = raw.split('.');
  const expected = sign(payload || '');
  if (!sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new HttpError(401, 'unauthorized', '로그인이 필요합니다.');
  }
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (data.exp * 1000 < Date.now()) throw new HttpError(401, 'unauthorized', '로그인이 만료되었습니다.');
  const a = await loadAuth();
  if (!a.hash || data.v !== a.session_ver) throw new HttpError(401, 'unauthorized', '로그인이 만료되었습니다.');
  return a;
}

/* ── 로그인 ─────────────────────────────────────────────── */
export async function login(username, password, remember, secure) {
  const a = await loadAuth();
  if (a.lock_until > Date.now()) {
    const min = Math.ceil((a.lock_until - Date.now()) / 60000);
    throw new HttpError(429, 'locked', `로그인 시도가 너무 많습니다. ${min}분 후 다시 시도해 주세요.`);
  }
  const okUser = String(username || '').trim().toLowerCase() === a.username;
  const okPw = await verifySecret(String(password || ''), a.hash); // 아이디가 틀려도 같은 시간 소요
  if (!okUser || !okPw) {
    a.fail = (a.fail || 0) + 1;
    if (a.fail >= MAX_FAIL) { a.lock_until = Date.now() + LOCK_MS; a.fail = 0; }
    await saveAuth(a);
    if (a.lock_until > Date.now()) throw new HttpError(429, 'locked', '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.');
    const left = MAX_FAIL - a.fail;
    throw new HttpError(401, 'bad_login', `아이디 또는 비밀번호가 올바르지 않습니다.${left <= 2 ? ` (${left}번 더 틀리면 15분간 잠깁니다)` : ''}`);
  }
  a.fail = 0;
  a.lock_until = 0;
  a.last_login = new Date().toISOString();
  await saveAuth(a);
  return makeCookie(a, !!remember, secure);
}

/* ── 비밀번호 설정 (일회용 링크) ─────────────────────────────── */
const tokenHash = t => createHash('sha256').update(String(t)).digest('hex');

/** 개발자용: 24시간 유효 일회용 링크 토큰 발급 */
export async function createSetupToken() {
  const token = randomBytes(32).toString('base64url');
  await (await kv()).set(SETUP_PREFIX + tokenHash(token), '1', 24 * 3600);
  return token;
}
export async function checkSetupToken(token) {
  if (!token || token.length > 100) return false;
  return !!(await (await kv()).get(SETUP_PREFIX + tokenHash(token)));
}

async function setPassword(a, password, secure) {
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, 'weak_password', problem);
  const code = newRecoveryCode();
  a.hash = await hashSecret(password);
  a.recovery_hash = await hashSecret(code);
  a.session_ver = (a.session_ver || 1) + 1;
  a.password_set_at = new Date().toISOString();
  a.fail = 0;
  a.lock_until = 0;
  a.last_login = a.password_set_at;
  await saveAuth(a);
  return { recoveryCode: code, cookie: makeCookie(a, false, secure) };
}

export async function setupWithToken(token, password, secure) {
  const store = await kv();
  const key = SETUP_PREFIX + tokenHash(token);
  if (!token || !(await store.get(key))) throw new HttpError(400, 'bad_token', '링크가 만료되었거나 이미 사용되었습니다.');
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, 'weak_password', problem);
  await store.del(key); // 일회용
  return setPassword(await loadAuth(), password, secure);
}

/** 복구 코드로 비밀번호 재설정 (로그인 실패 횟수 제한 공유) */
export async function recoverWithCode(username, code, password, secure) {
  const a = await loadAuth();
  if (a.lock_until > Date.now()) throw new HttpError(429, 'locked', '시도가 너무 많습니다. 15분 후 다시 시도해 주세요.');
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, 'weak_password', problem);
  const okUser = String(username || '').trim().toLowerCase() === a.username;
  const ok = await verifySecret(normCode(code), a.recovery_hash);
  if (!okUser || !ok) {
    a.fail = (a.fail || 0) + 1;
    if (a.fail >= MAX_FAIL) { a.lock_until = Date.now() + LOCK_MS; a.fail = 0; }
    await saveAuth(a);
    throw new HttpError(401, 'bad_code', '아이디 또는 복구 코드가 올바르지 않습니다.');
  }
  return setPassword(a, password, secure);
}

export async function changePassword(a, current, next, secure) {
  if (!(await verifySecret(String(current || ''), a.hash))) throw new HttpError(400, 'bad_current', '현재 비밀번호가 올바르지 않습니다.');
  if (current === next) throw new HttpError(400, 'same', '현재와 다른 비밀번호를 입력해 주세요.');
  return setPassword(a, next, secure);
}

export async function regenerateRecovery(a, current) {
  if (!(await verifySecret(String(current || ''), a.hash))) throw new HttpError(400, 'bad_current', '현재 비밀번호가 올바르지 않습니다.');
  const code = newRecoveryCode();
  a.recovery_hash = await hashSecret(code);
  await saveAuth(a);
  return code;
}

export async function logoutAll() {
  const a = await loadAuth();
  a.session_ver = (a.session_ver || 1) + 1;
  await saveAuth(a);
}

export async function unlock() {
  const a = await loadAuth();
  a.fail = 0;
  a.lock_until = 0;
  await saveAuth(a);
}
