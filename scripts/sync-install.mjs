// 동기화 프로그램을 Windows 로그인 시 자동 실행 (관리자 권한 불필요, 시작프로그램 폴더 사용)
//   npm run sync:install     설치 + 바로 시작
//   npm run sync:uninstall   해제 + 실행 중인 동기화 종료
import { writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './lib/extract.mjs';

if (process.platform !== 'win32') { console.error('Windows 전용입니다. 다른 OS에서는 npm run sync -- --watch 를 직접 실행하세요.'); process.exit(1); }

const startup = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const vbs = join(startup, 'chataekwondo-content-sync.vbs');
const lock = join(ROOT, '.cms', 'sync.lock');
const uninstall = process.argv.includes('--uninstall');

function stopRunning() {
  if (!existsSync(lock)) return;
  const pid = Number(readFileSync(lock, 'utf8'));
  try { process.kill(pid); console.log(`실행 중이던 동기화 종료 (pid ${pid})`); } catch { /* 이미 종료 */ }
  rmSync(lock, { force: true });
}

if (uninstall) {
  rmSync(vbs, { force: true });
  stopRunning();
  console.log('✓ 자동 실행을 해제했습니다.');
  process.exit(0);
}

if (!existsSync(join(ROOT, '.env.local'))) { console.error('✗ .env.local 이 없습니다. 먼저 설정해 주세요 (docs/CMS-개발자-가이드.md).'); process.exit(1); }

// 창 없이 실행하는 VBScript (UTF-16LE로 저장해야 경로의 한글이 깨지지 않음)
const q = s => s.replace(/"/g, '""');
const script = [
  'Set sh = CreateObject("WScript.Shell")',
  `sh.CurrentDirectory = "${q(ROOT)}"`,
  `sh.Run """${q(process.execPath)}"" ""${q(join(ROOT, 'scripts', 'cms-sync.mjs'))}"" --watch", 0, False`,
].join('\r\n');
writeFileSync(vbs, '﻿' + script, 'utf16le');
console.log(`✓ 자동 실행 등록: ${vbs}`);

stopRunning();
spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore' }).unref();
console.log('✓ 동기화 프로그램을 시작했습니다. 상태 확인: npm run sync -- --status  (기록: .cms/sync.log)');
