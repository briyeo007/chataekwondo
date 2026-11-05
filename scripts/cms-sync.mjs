// 콘텐츠 자동 동기화: 서버(관장님이 수정한 내용) ↔ 내 프로젝트 content/ 폴더
//   npm run sync                 한 번 동기화
//   npm run sync -- --watch      계속 실행 (2분마다 + content/ 파일을 고치면 바로). PC 로그인 시 자동 실행은 npm run sync:install
//   npm run sync -- --status     마지막 동기화 상태
//
// 한 번의 동기화 순서
//   1) 내가 content/ 에서 고친 내용 → 서버에 올림 (관장님이 같은 항목을 먼저 고쳤으면 올리지 않고 content/_충돌/ 에 보관)
//   2) 서버의 최신 내용 → content/ 에 기록 (아직 올리지 못한 내 수정 파일은 덮어쓰지 않음)
//   3) 새 사진 → content/media/ 에 내려받기
//   4) 하루 한 번 .cms/backups/ 에 전체 백업 (30일 보관)
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, readdirSync, appendFileSync, statSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './lib/extract.mjs';
import { loadEnv, api, download, flag } from './lib/remote.mjs';
import { exportToFiles, exportToBase, readContentDir, diffLocal } from './lib/content-files.mjs';

// (테스트용으로 CMS_CONTENT_DIR / CMS_WORK_DIR 로 위치 변경 가능)
const CONTENT = process.env.CMS_CONTENT_DIR || join(ROOT, 'content');
const CMS = process.env.CMS_WORK_DIR || join(ROOT, '.cms');
const STATE_FILE = join(CMS, 'sync-state.json');
const LOG_FILE = join(CMS, 'sync.log');
const LOCK_FILE = join(CMS, 'sync.lock');
const INTERVAL_MS = 2 * 60 * 1000;
const BACKUP_KEEP = 30;

mkdirSync(CMS, { recursive: true });
const site = loadEnv();

function log(msg) {
  const line = `[${new Date().toLocaleString('ko-KR', { hour12: false })}] ${msg}`;
  console.log(line);
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > 1024 * 1024) renameSync(LOG_FILE, LOG_FILE + '.old');
    appendFileSync(LOG_FILE, line + '\n');
  } catch { /* 로그 실패는 무시 */ }
}

const sha = s => createHash('sha256').update(s).digest('hex');
const loadState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null);
const saveState = s => writeFileSync(STATE_FILE, JSON.stringify(s));
const readIfExists = f => (existsSync(f) ? readFileSync(f, 'utf8') : null);
const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

if (flag('status')) {
  const s = loadState();
  console.log(s ? `마지막 동기화: ${new Date(s.synced_at).toLocaleString('ko-KR')} (버전 ${s.ver}, ${s.site})` : '아직 동기화한 적 없음');
  console.log(existsSync(LOCK_FILE) ? `실행 중 (pid ${readFileSync(LOCK_FILE, 'utf8')})` : '실행 중이 아님');
  if (existsSync(LOG_FILE)) console.log('\n최근 기록:\n' + readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-10).join('\n'));
  process.exit(0);
}

/* ── 1) 내 수정 올리기 ─────────────────────────────────────── */
async function pushLocal(state) {
  if (!state || !existsSync(CONTENT)) return { touched: new Set(), pushed: 0 };
  let local;
  try { local = readContentDir(CONTENT); } catch (e) { log(`⚠ ${e.message} — 고칠 때까지 올리지 않습니다.`); return { touched: null, pushed: 0 }; }
  const { changes, warnings } = diffLocal(local, state.base);
  warnings.forEach(w => log(`⚠ ${w}`));
  const touched = new Set();
  if (!changes.length) return { touched, pushed: 0 };
  log(`내 수정 ${changes.length}건을 서버에 올립니다: ${changes.map(c => c.label).join(', ')}`);
  const { results } = await api('POST', 'push', { changes: changes.map(({ ref, table, key, version, data }) => ({ ref, table, key, version, data })) });
  let pushed = 0;
  for (const r of results) {
    const c = changes.find(x => x.ref === r.ref);
    touched.add(c.file);
    if (c.file.startsWith('posts/')) ['body.html', 'after.html'].forEach(ext => touched.add(c.file.replace(/json$/, ext)));
    if (r.ok) { pushed++; continue; }
    // 충돌·오류: 내 수정본을 _충돌 폴더에 보관하고 서버 내용으로 되돌림
    const dir = join(CONTENT, '_충돌', stamp());
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${c.ref.replace(/[:/]/g, '_')}.json`), JSON.stringify({ 이유: r.message, 항목: c.label, 내_수정: c.data }, null, 2));
    log(`⚠ 반영 못 함 — ${c.label}: ${r.message} → 내 수정본: content/_충돌/${dir.split(/[\\/]/).pop()}/`);
  }
  if (pushed) log(`✓ ${pushed}건 반영됨`);
  return { touched, pushed };
}

/* ── 2) 서버 내용 받기 ─────────────────────────────────────── */
async function pull(state, touched, force) {
  const since = force || !state ? -1 : state.ver;
  const exp = await api('GET', `pull?since=${since}`);
  if (exp.unchanged) return { state, changed: 0 };
  const files = exportToFiles(exp);
  const prevHashes = state?.files || {};

  // 처음 동기화인데 content/ 가 이미 있으면 기존 폴더를 보관
  if (!state && existsSync(CONTENT) && readdirSync(CONTENT).some(f => !f.startsWith('_') && f !== 'media')) {
    const keep = join(CMS, 'removed', `content-before-first-sync-${stamp()}`);
    mkdirSync(dirname(keep), { recursive: true });
    for (const f of readdirSync(CONTENT).filter(f => !f.startsWith('_') && f !== 'media')) {
      mkdirSync(keep, { recursive: true });
      renameSync(join(CONTENT, f), join(keep, f));
    }
    log(`기존 content/ 폴더를 ${keep} 에 보관했습니다.`);
  }

  let changed = 0;
  const hashes = {};
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(CONTENT, rel);
    const cur = readIfExists(abs);
    hashes[rel] = sha(text);
    if (cur === text) continue;
    const locallyEdited = cur !== null && prevHashes[rel] && sha(cur) !== prevHashes[rel];
    if (locallyEdited && (!touched || !touched.has(rel))) {
      // 아직 서버에 올리지 않은 내 수정 → 덮어쓰지 않고 다음 동기화 때 올림
      hashes[rel] = prevHashes[rel];
      log(`· ${rel}: 내 수정이 아직 올라가지 않아 이번에는 덮어쓰지 않았습니다.`);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    changed++;
  }
  // 서버에서 사라진 글 파일(휴지통·영구 삭제) → .cms/removed 로 이동
  for (const rel of Object.keys(prevHashes)) {
    if (files[rel] !== undefined) continue;
    const abs = join(CONTENT, rel);
    if (!existsSync(abs)) continue;
    const dest = join(CMS, 'removed', stamp(), rel);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(abs, dest);
    changed++;
  }
  if (changed) log(`✓ 서버 변경을 content/ 에 반영했습니다 (파일 ${changed}개, 버전 ${exp.ver})`);

  await syncMedia(exp.doc.media || {});
  const next = { site, ver: exp.ver, synced_at: new Date().toISOString(), base: exportToBase(exp), files: hashes };
  saveState(next);
  return { state: next, changed };
}

/* ── 3) 사진 사본 ─────────────────────────────────────────── */
async function syncMedia(media) {
  let n = 0;
  for (const [path, m] of Object.entries(media)) {
    if (path.includes('..')) continue;
    const abs = join(CONTENT, 'media', path);
    if (existsSync(abs)) continue;
    try {
      const buf = await download(m.url);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, buf);
      n++;
    } catch (e) { log(`⚠ 사진 내려받기 실패 ${path}: ${e.message}`); }
  }
  if (n) log(`✓ 새 사진 ${n}장을 content/media/ 에 저장했습니다.`);
}

/* ── 4) 하루 한 번 백업 ─────────────────────────────────────── */
async function dailyBackup() {
  const dir = join(CMS, 'backups');
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const target = join(dir, `daily-${today}`);
  if (existsSync(target)) return;
  const data = await api('GET', 'backup');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'backup.json'), JSON.stringify(data));
  const old = readdirSync(dir).filter(d => d.startsWith('daily-')).sort().slice(0, -BACKUP_KEEP);
  old.forEach(d => rmSync(join(dir, d), { recursive: true, force: true }));
  log(`✓ 오늘 백업 저장: .cms/backups/daily-${today}`);
}

/* ── 한 번 실행 ─────────────────────────────────────────────── */
let running = false;
let writingUntil = 0;
async function cycle(reason = '') {
  if (running) return;
  running = true;
  try {
    let state = loadState();
    if (state && state.site !== site) { log(`대상 사이트가 바뀌어 처음부터 다시 받습니다 (${state.site} → ${site})`); state = null; }
    const { touched, pushed } = await pushLocal(state);
    writingUntil = Date.now() + 3000;
    await pull(state, touched, pushed > 0);
    writingUntil = Date.now() + 3000;
    await dailyBackup();
  } catch (e) {
    log(`✗ 동기화 실패${reason ? ` (${reason})` : ''}: ${e.message} — 다음에 다시 시도합니다.`);
  } finally {
    running = false;
  }
}

if (!flag('watch')) {
  await cycle();
  process.exit(0);
}

/* ── 계속 실행 모드 ─────────────────────────────────────────── */
// 중복 실행 방지
if (existsSync(LOCK_FILE)) {
  const pid = Number(readFileSync(LOCK_FILE, 'utf8'));
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { /* 종료된 프로세스 */ }
  if (alive && pid !== process.pid) { console.log(`이미 동기화 프로그램이 실행 중입니다 (pid ${pid}).`); process.exit(0); }
}
writeFileSync(LOCK_FILE, String(process.pid));
const cleanup = () => { try { if (readFileSync(LOCK_FILE, 'utf8') === String(process.pid)) rmSync(LOCK_FILE); } catch { /* */ } process.exit(0); };
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

log(`동기화 프로그램 시작 (${site}, ${INTERVAL_MS / 60000}분마다)`);
await cycle('시작');
setInterval(() => cycle(), INTERVAL_MS);

// content/ 파일을 고치면 5초 뒤 바로 올림
let timer = null;
mkdirSync(CONTENT, { recursive: true });
watch(CONTENT, { recursive: true }, (event, file) => {
  if (!file || Date.now() < writingUntil) return;
  if (/^(media|_충돌)[\\/]|README\.md$/.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(() => cycle('파일 수정'), 5000);
});
