// 복구: 백업 폴더(backup.json)의 내용으로 서버 콘텐츠를 되돌린다.
//   npm run cms:restore -- <백업폴더>            미리보기 (무엇이 바뀌는지만 표시)
//   npm run cms:restore -- <백업폴더> --apply    실제 복구
// 동작
//  * 백업에 있고 서버에 없는 항목 → 다시 추가 (같은 id)
//  * 백업과 서버 내용이 다른 항목 → 백업 내용으로 되돌림 (되돌리기 전 내용은 변경 기록에 자동 보관)
//  * 서버에만 있는 항목(백업 이후 새로 생긴 것) → 그대로 둠
//  * 사진: 백업 폴더의 media/ 중 서버 목록에 없는 파일을 다시 올림
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadEnv, api, flag, positional, confirm, fail } from './lib/remote.mjs';
import { POST_FIELDS, GALLERY_FIELDS } from './lib/content-files.mjs';

loadEnv();
const dir = positional()[0];
if (!dir || !existsSync(join(dir, 'backup.json'))) { console.error('사용법: npm run cms:restore -- <백업폴더> [--apply]'); process.exit(1); }
const backup = JSON.parse(readFileSync(join(dir, 'backup.json'), 'utf8'));

try {
  const cur = await api('GET', 'pull?since=-1');
  const plan = [];
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  const tables = [
    { name: 'content_blocks', coll: 'blocks', fields: ['value', 'meta'], insertFields: ['key', 'page', 'label', 'type', 'sort', 'value', 'meta'] },
    { name: 'posts', coll: 'posts', fields: [...POST_FIELDS, 'deleted_at', 'body_html', 'after_html'], insertFields: ['slug', ...POST_FIELDS, 'deleted_at', 'body_html', 'after_html'] },
    { name: 'gallery_items', coll: 'gallery', fields: [...GALLERY_FIELDS, 'deleted_at', 'storage_path'], insertFields: [...GALLERY_FIELDS, 'deleted_at', 'storage_path'] },
  ];
  const withBody = (exp, id, item) => (exp.bodies?.[id] ? { ...item, ...exp.bodies[id] } : item);

  for (const t of tables) {
    let add = 0, revert = 0;
    for (const [id, raw] of Object.entries(backup.doc[t.coll])) {
      const b = withBody(backup, id, raw);
      const c = cur.doc[t.coll][id] && withBody(cur, id, cur.doc[t.coll][id]);
      const pick = keys => Object.fromEntries(keys.filter(k => k in b).map(k => [k, b[k]]));
      if (!c) { plan.push({ table: t.name, id, version: null, data: pick(t.insertFields), label: `${t.name} 추가 ${id}` }); add++; continue; }
      const diff = t.fields.filter(k => k in b && !same(b[k], c[k]));
      if (diff.length) { plan.push({ table: t.name, key: id, version: c.version, data: pick(diff), label: `${t.name} 되돌림 ${id}` }); revert++; }
    }
    const extra = Object.keys(cur.doc[t.coll]).filter(id => !backup.doc[t.coll][id]).length;
    console.log(`${t.name}: 다시 추가 ${add}, 되돌림 ${revert}, 서버에만 있음(유지) ${extra}`);
  }

  const files = Object.keys(backup.doc.media || {}).filter(p => !cur.doc.media?.[p] && existsSync(join(dir, 'media', p)));
  console.log(`사진: 다시 올릴 파일 ${files.length}개`);

  if (!plan.length && !files.length) { console.log('✓ 복구할 내용 없음 (백업과 동일)'); process.exit(0); }
  if (!flag('apply')) { console.log('\n미리보기입니다. 실제로 복구하려면 --apply 를 붙이세요.'); process.exit(0); }
  if (!(await confirm(`${plan.length}개 항목, 사진 ${files.length}개를 복구합니다.`))) process.exit(0);

  const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  for (const p of files) {
    await api('POST', `upload?path=${encodeURIComponent(p)}`, readFileSync(join(dir, 'media', p)), { raw: true, contentType: TYPES[extname(p).toLowerCase()] });
  }
  const { results } = await api('POST', 'push', { changes: plan.map((p, i) => ({ ref: String(i), table: p.table, key: p.key, id: p.id, version: p.version, data: p.data, actor: 'restore' })) });
  const failed = results.filter(r => !r.ok);
  failed.forEach(r => console.log(`✗ ${plan[+r.ref].label}: ${r.message}`));
  console.log(`✓ 복구 ${results.length - failed.length}건${failed.length ? `, 실패 ${failed.length}건 (다시 실행하면 재시도)` : ''}. npm run cms:verify 로 확인하세요.`);
} catch (e) { fail(e); }
