// 이전 검증: HTML의 모든 콘텐츠가 서버에 있는지 확인하고, 서버 내용으로 렌더링한 페이지를 원본과 비교한다.
//   npm run cms:verify
// 이전 직후에는 "모든 페이지 동일"이 나와야 정상. 관장님이 수정한 뒤에는 수정한 부분만 차이로 나온다.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, extractAll } from './lib/extract.mjs';
import { loadEnv, api, fail } from './lib/remote.mjs';
import { exportToRenderData } from './lib/content-files.mjs';

loadEnv();
let exp;
try { exp = await api('GET', 'pull?since=-1'); } catch (e) { fail(e); }
const src = extractAll();
const data = exportToRenderData(exp);

let missing = 0;
const keys = new Set(data.blocks.map(b => b.key));
for (const b of src.blocks) if (!keys.has(b.key)) { missing++; console.log(`✗ 문구 누락: ${b.key}`); }
const slugs = new Set(data.posts.map(p => p.slug));
for (const p of src.posts) if (!slugs.has(p.slug)) { missing++; console.log(`✗ 글 누락: ${p.slug}`); }
for (const g of src.gallery) {
  if (!data.gallery.some(x => x.pane === g.pane && x.src === g.src)) { missing++; console.log(`✗ 갤러리 누락: ${g.pane} ${g.src}`); }
}
console.log(`문구 ${data.blocks.length}/${src.blocks.length}, 글 ${data.posts.length}/${src.posts.length}, 갤러리 ${data.gallery.filter(g => !g.deleted_at).length}(삭제 제외)/${src.gallery.length}`);
console.log(missing ? `✗ 누락 ${missing}건` : '✓ 누락 없음');

mkdirSync(join(ROOT, '.cms'), { recursive: true });
const file = join(ROOT, '.cms', 'verify-data.json');
writeFileSync(file, JSON.stringify(data));
console.log('\n── 서버 내용으로 렌더링한 페이지 vs 현재 HTML ──');
const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-render.mjs'), '--data', file], { stdio: 'inherit' });
process.exit(missing || r.status ? 1 : 0);
