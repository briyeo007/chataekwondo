// 초기 콘텐츠 이전: 현재 HTML의 콘텐츠를 서버 저장소에 넣는다.
// ★ 이미 있는 항목은 절대 덮어쓰지 않는다 (없는 것만 추가).
//   → 개발자가 HTML에 새 수정 영역(data-cms)을 추가했을 때도 이 명령으로 등록한다.
//   npm run cms:seed
import { extractAll } from './lib/extract.mjs';
import { loadEnv, api, confirm, fail } from './lib/remote.mjs';

loadEnv();
const src = extractAll();
try {
  const cur = await api('GET', 'pull?since=-1');
  const keys = new Set(Object.keys(cur.doc.blocks));
  const slugs = new Set(Object.values(cur.doc.posts).map(p => p.slug));
  const newBlocks = src.blocks.filter(b => !keys.has(b.key));
  const newPosts = src.posts.filter(p => !slugs.has(p.slug));
  const galleryEmpty = Object.keys(cur.doc.gallery).length === 0;
  const htmlKeys = new Set(src.blocks.map(b => b.key));
  const orphan = [...keys].filter(k => !htmlKeys.has(k));

  console.log(`페이지 문구: HTML ${src.blocks.length}개 / 서버 ${keys.size}개 → 새로 추가 ${newBlocks.length}개`);
  newBlocks.forEach(b => console.log(`  + ${b.key} (${b.label})`));
  console.log(`소식 글:     HTML ${src.posts.length}개 / 서버 ${slugs.size}개 → 새로 추가 ${newPosts.length}개`);
  newPosts.forEach(p => console.log(`  + post-${p.slug}.html`));
  console.log(`갤러리:      HTML ${src.gallery.length}장 / 서버 ${Object.keys(cur.doc.gallery).length}장 → ${galleryEmpty ? `새로 추가 ${src.gallery.length}장` : '이미 이전됨, 건너뜀'}`);
  if (orphan.length) console.log(`⚠ 서버에는 있지만 HTML에 표시가 없는 항목 (화면에 쓰이지 않음): ${orphan.join(', ')}`);

  if (!newBlocks.length && !newPosts.length && !(galleryEmpty && src.gallery.length)) { console.log('✓ 추가할 항목 없음'); process.exit(0); }
  if (!(await confirm('위 항목을 서버에 추가합니다 (기존 데이터는 변경하지 않음).'))) process.exit(0);
  const r = await api('POST', 'seed', { blocks: newBlocks, posts: newPosts, gallery: galleryEmpty ? src.gallery : [] });
  console.log(`✓ 추가 완료: 문구 ${r.blocks}, 글 ${r.posts}, 갤러리 ${r.gallery}`);
  console.log('  이어서 npm run cms:verify 로 확인하고, npm run sync 로 content/ 폴더를 받으세요.');
} catch (e) { fail(e); }
