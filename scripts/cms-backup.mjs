// 백업: 서버의 전체 콘텐츠(삭제된 항목·변경 기록 포함)와 사진을 내려받는다.
//   npm run cms:backup                   → .cms/backups/manual-<날짜시간>/
//   npm run cms:backup -- --no-files     사진 제외
//   npm run cms:backup -- --cloud        서버 자동 백업(매일, 30일) 목록
//   npm run cms:backup -- --cloud 2026-11-05   해당 날짜 자동 백업을 내려받아 복호화 (.env.local 에 BACKUP_KEY 필요)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createDecipheriv, createHash } from 'node:crypto';
import { ROOT } from './lib/extract.mjs';
import { loadEnv, api, download, flag, option, positional, fail } from './lib/remote.mjs';

loadEnv();
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

function decrypt(buf) {
  const secret = process.env.BACKUP_KEY;
  if (!secret) throw new Error('.env.local 에 BACKUP_KEY 가 없습니다 (Vercel 환경변수와 같은 값).');
  if (buf.subarray(0, 5).toString() !== 'CMSB1') throw new Error('백업 파일 형식이 아닙니다.');
  const key = createHash('sha256').update(secret).digest();
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(5, 17));
  d.setAuthTag(buf.subarray(17, 33));
  return Buffer.concat([d.update(buf.subarray(33)), d.final()]);
}

async function saveMedia(out, media) {
  let n = 0;
  for (const [path, m] of Object.entries(media || {})) {
    if (path.includes('..')) continue;
    const dest = join(out, 'media', path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, await download(m.url));
    n++;
  }
  console.log(`✓ 사진 ${n}장`);
}

try {
  if (flag('cloud')) {
    const list = (await api('GET', 'backups')).sort((a, b) => a.pathname.localeCompare(b.pathname));
    const day = positional()[0];
    if (!day) {
      console.log('서버 자동 백업 목록:');
      list.forEach(b => console.log(`  ${b.pathname.replace(/^backups\/|\.json\.enc$/g, '')}`));
      console.log('\n내려받기: npm run cms:backup -- --cloud <날짜>');
      process.exit(0);
    }
    const item = list.find(b => b.pathname === `backups/${day}.json.enc`);
    if (!item) throw new Error(`${day} 백업이 없습니다.`);
    const data = JSON.parse(decrypt(await download(item.url)).toString());
    const out = option('out') || join(ROOT, '.cms', 'backups', `cloud-${day}`);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'backup.json'), JSON.stringify(data));
    console.log(`✓ 복호화 완료 (버전 ${data.ver})`);
    if (!flag('no-files')) await saveMedia(out, data.doc.media);
    console.log(`백업 위치: ${out}`);
    process.exit(0);
  }

  const data = await api('GET', 'backup');
  const out = option('out') || join(ROOT, '.cms', 'backups', `manual-${stamp}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'backup.json'), JSON.stringify(data, null, 1));
  const d = data.doc;
  console.log(`✓ 콘텐츠: 문구 ${Object.keys(d.blocks).length}, 글 ${Object.keys(d.posts).length}, 갤러리 ${Object.keys(d.gallery).length}, 변경 기록 ${data.revisions.length} (버전 ${data.ver})`);
  if (!flag('no-files')) await saveMedia(out, d.media);
  console.log(`\n백업 위치: ${out}`);
} catch (e) { fail(e); }
