// 통합 테스트: 로컬 테스트 저장소로 개발 서버를 띄워 관리자 로그인·수정·충돌 방지·업로드·복구·동기화를 실제로 시험한다.
//   npm test
//   npm run test:storage → 실제 Upstash Redis·Vercel Blob 으로 같은 시험 (.cms/vercel-dev.env 의 연결 정보 사용).
//     모든 키·파일에 임의 접두사를 붙여 운영 데이터와 분리하고, 끝나면 시험 데이터를 모두 지운다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, extractAll } from './lib/extract.mjs';

const PORT = 3900 + Math.floor(Math.random() * 90);
const SITE = `http://localhost:${PORT}`;
const WORK = join(ROOT, '.cms', `test-${Date.now()}`);
const STORE = join(WORK, 'store');
const CONTENT = join(WORK, 'content');
const ENV_FILE = join(WORK, 'test.env');
const TOKEN = randomBytes(32).toString('base64url');
const REAL = process.env.CMS_TEST_STORAGE || (process.argv.includes('--storage') ? join(ROOT, '.cms', 'vercel-dev.env') : null);
const RUN_ID = randomBytes(4).toString('hex');
const KEY_PREFIX = `cmstest-${RUN_ID}:`;
const MEDIA_PREFIX = `_cmstest-${RUN_ID}/`;
let realEnv = null;
let redis = null;
let prodKeysBefore = null;
let server;
let cookie = '';
let recoveryCode = '';
const PASSWORD = 'Taekwondo2026';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer(env, port = PORT) {
  // Vercel 함수처럼 ES 모듈 require() 미지원 조건으로 실행
  const p = spawn(process.execPath, ['--no-experimental-require-module', join(ROOT, 'scripts', 'dev-server.mjs'), '--env', env.file], {
    env: { ...process.env, PORT: String(port), CMS_DOC_CACHE_MS: '0', ...env.extra }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    p.stdout.on('data', d => { if (String(d).includes('http://localhost')) resolve(); });
    p.stderr.on('data', d => process.stderr.write(d));
    p.on('exit', c => reject(new Error(`server exit ${c}`)));
  });
  return p;
}

/* ── 실제 저장소 모드 도우미 ─────────────────────────────── */
async function scanKeys(match) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, { match, count: 500 });
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== '0');
  return keys;
}
/** 이번 시험이 만든 키·파일 모두 삭제 */
async function cleanupReal() {
  const keys = await scanKeys(`${KEY_PREFIX}*`);
  for (let i = 0; i < keys.length; i += 100) await redis.del(...keys.slice(i, i + 100));
  const { list, del } = await import('@vercel/blob');
  const opts = { token: realEnv.BLOB_READ_WRITE_TOKEN };
  let blobs = (await list({ prefix: MEDIA_PREFIX, limit: 1000, ...opts })).blobs;
  let files = 0;
  while (blobs.length) {
    files += blobs.length;
    await del(blobs.map(b => b.url), opts);
    blobs = (await list({ prefix: MEDIA_PREFIX, limit: 1000, ...opts })).blobs;
  }
  return { keys: keys.length, files, left: (await scanKeys(`${KEY_PREFIX}*`)).length };
}
const otherKeys = async () => (await scanKeys('*')).filter(k => !k.startsWith('cmstest-')).sort();

before(async () => {
  mkdirSync(WORK, { recursive: true });
  const lines = [`CMS_SITE_URL=${SITE}`, `CMS_SYNC_TOKEN=${TOKEN}`, `SESSION_SECRET=${randomBytes(32).toString('base64url')}`,
    `BACKUP_KEY=${randomBytes(32).toString('base64url')}`];
  if (REAL) {
    if (!existsSync(REAL)) throw new Error(`연결 정보 파일이 없습니다: ${REAL}`);
    const { parseEnv } = await import('node:util');
    realEnv = parseEnv(readFileSync(REAL, 'utf8'));
    const url = realEnv.KV_REST_API_URL || realEnv.UPSTASH_REDIS_REST_URL;
    const token = realEnv.KV_REST_API_TOKEN || realEnv.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token || !realEnv.BLOB_READ_WRITE_TOKEN) throw new Error(`${REAL} 에 KV_REST_API_URL / KV_REST_API_TOKEN / BLOB_READ_WRITE_TOKEN 이 없습니다`);
    const { Redis } = await import('@upstash/redis');
    redis = new Redis({ url, token, automaticDeserialization: false });
    prodKeysBefore = await otherKeys();
    console.log(`실제 저장소 시험 — 키 접두사 ${KEY_PREFIX}, 사진 폴더 ${MEDIA_PREFIX}, 기존 키 ${prodKeysBefore.length}개`);
    lines.push(`KV_REST_API_URL=${url}`, `KV_REST_API_TOKEN=${token}`, `BLOB_READ_WRITE_TOKEN=${realEnv.BLOB_READ_WRITE_TOKEN}`,
      `CMS_KEY_PREFIX=${KEY_PREFIX}`, `CMS_MEDIA_PREFIX=${MEDIA_PREFIX}`);
  } else {
    lines.push(`CMS_STORE_DIR=${STORE.replace(/\\/g, '/')}`);
  }
  writeFileSync(ENV_FILE, lines.join('\n'));
  server = await startServer({ file: ENV_FILE });
});
after(async () => {
  server?.kill();
  rmSync(WORK, { recursive: true, force: true });
  if (REAL) await cleanupReal().catch(e => console.error(`✗ 시험 데이터 정리 실패 (접두사 ${KEY_PREFIX}):`, e.message));
});

/* ── 요청 도우미 ─────────────────────────────────────────── */
async function admin(method, path, body, { headers = {}, raw } = {}) {
  const res = await fetch(`${SITE}/api/admin/${path}`, {
    method,
    headers: { 'X-CMS': '1', Origin: SITE, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => ({})), setCookie };
}
async function sync(method, path, body, token = TOKEN) {
  const res = await fetch(`${SITE}/api/sync/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function page(path) {
  const res = await fetch(SITE + path);
  return { status: res.status, mode: res.headers.get('x-cms'), html: await res.text() };
}
const runSync = (extraEnv = {}) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'cms-sync.mjs'), '--env', ENV_FILE], {
  env: { ...process.env, CMS_CONTENT_DIR: CONTENT, CMS_WORK_DIR: WORK, ...extraEnv }, encoding: 'utf8',
});

/* ── 테스트 ─────────────────────────────────────────────── */

// Vercel 함수 실행 환경은 CommonJS 모듈에서 ES 모듈을 require() 할 수 없다 (2026-11-05 운영 500 오류 원인).
// 같은 조건으로 서버 함수와 저장소 라이브러리를 불러와 본다.
test('Vercel 실행 환경 호환: 서버 함수 로딩', () => {
  const url = f => 'file:///' + join(ROOT, f).replace(/\\/g, '/');
  const code = ['api/render.js', 'api/admin.js', 'api/sync.js'].map(f => `await import(${JSON.stringify(url(f))});`).join('')
    + "await import('@vercel/blob'); await import('@upstash/redis');";
  const r = spawnSync(process.execPath, ['--no-experimental-require-module', '--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('설정 상태 · 토큰 없는 동기화 요청 차단', async () => {
  assert.equal((await admin('GET', 'status')).data.configured, true);
  assert.equal((await sync('GET', 'pull', null, '')).status, 401);
  assert.equal((await sync('GET', 'pull', null, 'x'.repeat(43))).status, 401);
});

test('최초 이전: 없는 것만 추가, 두 번 실행해도 덮어쓰지 않음', async () => {
  const src = extractAll();
  const r1 = await sync('POST', 'seed', src);
  assert.deepEqual([r1.data.blocks, r1.data.posts, r1.data.gallery], [src.blocks.length, src.posts.length, src.gallery.length]);
  const r2 = await sync('POST', 'seed', src);
  assert.deepEqual([r2.data.blocks, r2.data.posts, r2.data.gallery], [0, 0, 0]);
  const p = await page('/greeting.html');
  assert.equal(p.mode, 'db');
  assert.match(p.html, /수련생 여러분 환영합니다/);
});

test('비밀번호 설정 전 로그인 불가 · 일회용 링크로 설정', async () => {
  assert.equal((await admin('GET', 'me')).status, 401);
  assert.equal((await admin('POST', 'login', { username: 'master', password: PASSWORD })).status, 401);
  const { data: { token } } = await sync('POST', 'admin-link');
  assert.equal((await admin('GET', `setup-check?token=${token}`)).data.valid, true);
  assert.equal((await admin('POST', 'setup', { token, password: 'short1' })).status, 400);
  const ok = await admin('POST', 'setup', { token, password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.match(ok.data.recoveryCode, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Strict/);
  recoveryCode = ok.data.recoveryCode;
  assert.equal((await admin('POST', 'setup', { token, password: PASSWORD })).data.error, 'bad_token'); // 재사용 불가
  assert.equal((await admin('GET', 'me')).data.username, 'master');
});

test('비밀번호는 해시로만 저장', async () => {
  const kv = REAL
    ? (await Promise.all((await scanKeys(`${KEY_PREFIX}*`)).map(async k =>
      `${k}=${(await redis.type(k)) === 'list' ? (await redis.lrange(k, 0, -1)).join() : await redis.get(k)}`))).join('\n')
    : readFileSync(join(STORE, 'kv.json'), 'utf8');
  assert.doesNotMatch(kv, new RegExp(PASSWORD));
  assert.doesNotMatch(kv, new RegExp(recoveryCode));
  assert.match(kv, /scrypt\$/);
});

test('다른 사이트에서 보낸 요청 차단 (CSRF)', async () => {
  assert.equal((await admin('PATCH', 'block', {}, { headers: { 'X-CMS': '' } })).status, 403);
  assert.equal((await admin('PATCH', 'block', {}, { headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('문구 수정 → 홈페이지 반영, 옛 버전으로 저장하면 충돌', async () => {
  const blocks = (await admin('GET', 'blocks?page=index')).data;
  const b = blocks.find(x => x.key === 'index.hero.desc');
  const r = await admin('PATCH', 'block', { key: b.key, version: b.version, patch: { value: '관장님이 수정한 문구' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.version, b.version + 1);
  const again = await admin('PATCH', 'block', { key: b.key, version: b.version, patch: { value: '덮어쓰기 시도' } });
  assert.equal(again.status, 409);
  assert.equal(again.data.error, 'version_conflict');
  assert.match((await page('/')).html, /관장님이 수정한 문구/);
});

test('사진 업로드: JPEG만 허용, 업로드한 사진 열람 가능', async () => {
  assert.equal((await admin('POST', 'upload?folder=gallery', Buffer.from('<svg/>'), { raw: true, headers: { 'Content-Type': 'image/svg+xml' } })).status, 415);
  assert.equal((await admin('POST', 'upload?folder=gallery', Buffer.from('notajpeg'.repeat(20)), { raw: true, headers: { 'Content-Type': 'image/jpeg' } })).status, 415);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(500)]);
  const up = await admin('POST', 'upload?folder=gallery', jpeg, { raw: true, headers: { 'Content-Type': 'image/jpeg' } });
  assert.equal(up.status, 200);
  if (REAL) assert.ok(up.data.url.startsWith('https://') && up.data.url.includes(`.public.blob.vercel-storage.com/${MEDIA_PREFIX}`), up.data.url);
  const img = await fetch(new URL(up.data.url, SITE));
  assert.equal(img.status, 200);
  const g = await admin('POST', 'gallery', { rows: [{ pane: 'daily', src: up.data.url, storage_path: up.data.path, caption: '새 사진', title: '새 사진', sort: -1 }] });
  assert.equal(g.status, 200);
  assert.match((await page('/gallery.html')).html, /새 사진/);
});

test('새 글 작성 → 페이지 생성, 휴지통 → 404', async () => {
  const r = await admin('POST', 'post', { title: '테스트 소식', category: '공지', published_on: '2026-11-05', excerpt: '요약', body_html: '<p>본문<script>x</script></p>' });
  assert.equal(r.status, 200);
  const p = await page(`/post-${r.data.slug}.html`);
  assert.equal(p.status, 200);
  assert.match(p.html, /<h1 class="article-title">테스트 소식<\/h1>/);
  assert.doesNotMatch(p.html, /<script>x<\/script>/);
  assert.match((await page('/news.html')).html, new RegExp(`post-${r.data.slug}`));
  await admin('PATCH', 'post', { id: r.data.id, version: r.data.version, patch: { deleted_at: new Date().toISOString() } });
  assert.equal((await page(`/post-${r.data.slug}.html`)).status, 404);
});

test('변경 기록으로 되돌리기', async () => {
  const revs = (await admin('GET', 'revisions')).data;
  const rev = revs.find(x => x.row_key === 'index.hero.desc');
  assert.ok(rev);
  assert.equal((await admin('POST', 'restore', { id: rev.id })).status, 200);
  assert.match((await page('/')).html, /20년 이상의 지도력/);
});

test('로그인 5회 실패 → 잠금, 개발자 명령으로 해제', async () => {
  const saved = cookie;
  cookie = '';
  for (let i = 0; i < 4; i++) assert.equal((await admin('POST', 'login', { username: 'master', password: 'wrong-pass-1' })).status, 401);
  assert.equal((await admin('POST', 'login', { username: 'master', password: 'wrong-pass-1' })).status, 429);
  assert.equal((await admin('POST', 'login', { username: 'master', password: PASSWORD })).status, 429); // 맞아도 잠김
  await sync('POST', 'admin-unlock');
  assert.equal((await admin('POST', 'login', { username: 'master', password: PASSWORD })).status, 200);
  cookie = cookie || saved;
});

test('복구 코드로 비밀번호 재설정 → 이전 세션·코드 무효', async () => {
  const oldCookie = cookie;
  cookie = '';
  const r = await admin('POST', 'recover', { username: 'master', code: recoveryCode.toLowerCase().replace(/-/g, ' '), password: 'NewPassword2026' });
  assert.equal(r.status, 200);
  assert.notEqual(r.data.recoveryCode, recoveryCode);
  const fresh = cookie;
  cookie = oldCookie;
  assert.equal((await admin('GET', 'me')).status, 401); // 이전 기기 로그아웃됨
  cookie = '';
  assert.equal((await admin('POST', 'recover', { username: 'master', code: recoveryCode, password: 'Another2026x' })).status, 401);
  cookie = fresh;
  assert.equal((await admin('GET', 'me')).status, 200);
});

test('동기화: 서버 → content/ 파일, 사진 사본', async () => {
  const r = runSync();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const blocks = JSON.parse(readFileSync(join(CONTENT, 'blocks.json'), 'utf8'));
  assert.equal(blocks.length, extractAll().blocks.length);
  assert.ok(existsSync(join(CONTENT, 'posts', 'minami.body.html')));
  assert.ok(readdirSync(join(CONTENT, 'media', 'gallery'), { recursive: true }).some(f => f.endsWith('.jpg')));
  assert.ok(readdirSync(join(WORK, 'backups')).some(d => d.startsWith('daily-')));
});

test('동기화: content/ 수정 → 서버 반영', async () => {
  const file = join(CONTENT, 'blocks.json');
  const blocks = JSON.parse(readFileSync(file, 'utf8'));
  blocks.find(b => b.key === 'news.hero.desc').value = 'VS Code에서 수정한 문구';
  writeFileSync(file, JSON.stringify(blocks, null, 2));
  writeFileSync(join(CONTENT, 'posts', 'dev-note.json'), JSON.stringify({ title: '개발자가 쓴 글', published_on: '2026-11-06', excerpt: '요약' }));
  writeFileSync(join(CONTENT, 'posts', 'dev-note.body.html'), '<p>파일로 작성</p>');
  const r = runSync();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match((await page('/news.html')).html, /VS Code에서 수정한 문구/);
  assert.equal((await page('/post-dev-note.html')).status, 200);
  assert.ok(JSON.parse(readFileSync(join(CONTENT, 'posts', 'dev-note.json'), 'utf8')).id); // 서버 id가 기록됨
});

test('동기화: 관장님과 같은 항목을 동시에 수정 → 관장님 내용 유지, 내 수정은 _충돌 에 보관', async () => {
  const b = (await admin('GET', 'blocks?page=news')).data.find(x => x.key === 'news.hero.desc');
  await admin('PATCH', 'block', { key: b.key, version: b.version, patch: { value: '관장님 최신 문구' } });
  const file = join(CONTENT, 'blocks.json');
  const blocks = JSON.parse(readFileSync(file, 'utf8'));
  blocks.find(x => x.key === 'news.hero.desc').value = '내 PC 문구';
  writeFileSync(file, JSON.stringify(blocks, null, 2));
  const r = runSync();
  assert.equal(r.status, 0);
  assert.match((await page('/news.html')).html, /관장님 최신 문구/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).find(x => x.key === 'news.hero.desc').value, '관장님 최신 문구');
  const conflicts = readdirSync(join(CONTENT, '_충돌'), { recursive: true }).filter(f => f.endsWith('.json'));
  assert.equal(conflicts.length, 1);
});

test('동기화: PC가 꺼진 동안의 변경도 다음 실행 때 모두 받음', async () => {
  const p = (await admin('GET', 'posts')).data.find(x => x.slug === 'kbs');
  await admin('PATCH', 'post', { id: p.id, version: p.version, patch: { title: 'PC 꺼진 동안 수정 1' } });
  const g = (await admin('GET', 'gallery')).data.find(x => x.pane === 'france');
  await admin('PATCH', 'gallery', { id: g.id, version: g.version, patch: { caption: 'PC 꺼진 동안 수정 2' } });
  assert.equal(runSync().status, 0);
  assert.equal(JSON.parse(readFileSync(join(CONTENT, 'posts', 'kbs.json'), 'utf8')).title, 'PC 꺼진 동안 수정 1');
  assert.ok(readFileSync(join(CONTENT, 'gallery.json'), 'utf8').includes('PC 꺼진 동안 수정 2'));
});

test('저장소 장애 시 content/ 사본으로 표시', async () => {
  const port = PORT + 100;
  const env = join(WORK, 'nostore.env');
  writeFileSync(env, `CMS_SITE_URL=http://localhost:${port}\n`);
  const s2 = await startServer({ file: env, extra: { CMS_CONTENT_DIR: CONTENT, CMS_STORE_DIR: '' } }, port);
  try {
    const res = await fetch(`http://localhost:${port}/news.html`);
    assert.equal(res.headers.get('x-cms'), 'content-files');
    assert.match(await res.text(), /관장님 최신 문구/);
  } finally { s2.kill(); }
});

test('모든 기기에서 로그아웃', async () => {
  assert.equal((await admin('POST', 'logout-all', {})).status, 200);
  assert.equal((await admin('GET', 'me')).status, 401);
});

test('실제 저장소: 시험 데이터 정리, 기존 키 변화 없음', { skip: !REAL }, async () => {
  server.kill();
  const r = await cleanupReal();
  console.log(`정리: 키 ${r.keys}개, 사진 ${r.files}개 삭제`);
  assert.ok(r.keys > 0);
  assert.equal(r.left, 0);
  assert.deepEqual(await otherKeys(), prodKeysBefore);
});
