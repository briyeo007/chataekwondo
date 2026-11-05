// 렌더링 단위 테스트: 콘텐츠를 수정했을 때 페이지에 올바르게 반영되는지, 위험한 입력이 차단되는지 확인.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, extractAll } from './lib/extract.mjs';

const base = extractAll();
const dataFile = join(ROOT, '.cms', 'test-data.json');
mkdirSync(join(ROOT, '.cms'), { recursive: true });
process.env.CMS_LOCAL_DATA = dataFile;
delete process.env.SUPABASE_URL;

const { default: handler } = await import('../api/render.js');
const { resetLocalCache } = await import('../api/_lib/data.js');

// 데이터를 바꿔 가며 렌더링
async function renderWith(mutate, query) {
  const data = structuredClone(base);
  mutate(data);
  writeFileSync(dataFile, JSON.stringify(data));
  resetLocalCache();
  let body = '';
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { body = b; } };
  await handler({ url: `/api/render?${query}` }, res);
  return { status: res.statusCode, body, mode: res.headers['X-CMS'] };
}
const block = (d, key) => d.blocks.find(b => b.key === key);

test('텍스트 수정: 줄바꿈과 특수문자', async () => {
  const r = await renderWith(d => { block(d, 'index.hero.title').value = '새 제목 <b>&\n두 번째 줄'; }, 'page=index');
  assert.match(r.body, /data-cms="index.hero.title"[^>]*>새 제목 &lt;b&gt;&amp;<br>두 번째 줄<\/h1>/);
});

test('숫자 수정: 카운터 data-target 도 함께 변경', async () => {
  const r = await renderWith(d => { block(d, 'index.stat1.num').value = '25'; }, 'page=index');
  assert.match(r.body, /<span class="num" data-target="25"[^>]*>25<\/span>/);
});

test('이미지 수정: src 와 alt', async () => {
  const r = await renderWith(d => { const b = block(d, 'greeting.photo'); b.value = 'https://x.public.blob.vercel-storage.com/pages/a.jpg'; b.meta = { alt: '새 사진 "설명"' }; }, 'page=greeting');
  assert.match(r.body, /<img data-cms="greeting.photo"[^>]*src="https:\/\/x\.public\.blob\.vercel-storage\.com\/pages\/a\.jpg" alt="새 사진 &quot;설명&quot;">/);
});

test('줄 목록: 항목 추가·삭제, 첫 항목 모양 유지', async () => {
  const r = await renderWith(d => { block(d, 'instructor.chips').value = '공인 9단\n새 자격'; }, 'page=instructor');
  assert.match(r.body, /<span class="chip accent">공인 9단<\/span>\s*<span class="chip">새 자격<\/span>\s*<\/div>/);
  const r2 = await renderWith(d => { block(d, 'instructor.awards').value = '🏆 | 새 표창\n🥇 | 두 번째'; }, 'page=instructor');
  assert.match(r2.body, /<div class="award-icon">🏆<\/div>\s*<div class="award-text">새 표창<\/div>/);
  assert.equal((r2.body.match(/class="award-item"/g) || []).length, 2);
});

test('HTML 영역: 스크립트·이벤트·javascript 링크 제거 (XSS 방지)', async () => {
  const evil = '<p onclick="alert(1)">안녕</p><script>alert(2)</script><img src=x onerror="alert(3)"><a href="javascript:alert(4)">x</a><iframe src="https://evil.com"></iframe><iframe src="https://www.youtube.com/embed/abc"></iframe>';
  const r = await renderWith(d => { block(d, 'greeting.message').value = evil; }, 'page=greeting');
  const region = r.body.split('<!--cms:greeting.message')[1].split('<!--/cms:greeting.message-->')[0];
  assert.doesNotMatch(region, /onclick|onerror|<script|javascript:|evil\.com/);
  assert.match(region, /<p>안녕<\/p>/);
  assert.match(region, /youtube\.com\/embed\/abc/);
});

test('텍스트 필드에 HTML 넣어도 글자로 표시', async () => {
  const r = await renderWith(d => { block(d, 'news.hero.desc').value = '<script>alert(1)</script>'; }, 'page=news');
  assert.match(r.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(r.body, /<script>alert\(1\)/);
});

test('새 글: 공통 템플릿으로 렌더, 목록·메인에 표시', async () => {
  const post = { slug: '20261105-ab12', title: '새 소식 <제목>', category: '공지', published_on: '2026-11-05', excerpt: '요약', cover_url: '/images/water-1.jpg', cover_alt: '사진', body_html: '<p>본문</p>', after_html: '', is_published: true, sort: 0 };
  const r = await renderWith(d => d.posts.push(post), 'post=20261105-ab12');
  assert.equal(r.status, 200);
  assert.match(r.body, /<title>새 소식 &lt;제목&gt; – 차 태권도<\/title>/);
  assert.match(r.body, /<h1 class="article-title">새 소식 &lt;제목&gt;<\/h1>/);
  assert.match(r.body, /2026년 11월 5일 · 차 태권도/);
  assert.match(r.body, /<div class="article-body">\s*<p>본문<\/p>/);
  assert.doesNotMatch(r.body, /미나미/); // 템플릿 원본 내용이 남지 않아야 함
  const list = await renderWith(d => d.posts.push(post), 'page=news');
  assert.match(list.body, /<a href="post-20261105-ab12\.html" class="news-card featured">/);
  const idx = await renderWith(d => d.posts.push(post), 'page=index');
  assert.match(idx.body, /href="post-20261105-ab12\.html"/);
});

test('삭제·비공개 글은 404, 목록에서 제외', async () => {
  const r = await renderWith(d => { d.posts.find(p => p.slug === 'kbs').deleted_at = '2026-11-05T00:00:00Z'; }, 'post=kbs');
  assert.equal(r.status, 404);
  const list = await renderWith(d => { d.posts.find(p => p.slug === 'kbs').is_published = false; }, 'page=news');
  assert.doesNotMatch(list.body, /post-kbs\.html/);
});

test('사진 묶음이 없던 기존 글에 사진 추가 → 보충 CSS/JS 삽입', async () => {
  const r = await renderWith(d => {
    const p = d.posts.find(x => x.slug === 'white-belt-47');
    p.after_html += '<div class="gallery-section"><h2>📷 현장 스케치</h2><div class="gallery-grid" id="galleryGrid"><img src="/images/a.jpg" alt=""></div></div>';
  }, 'post=white-belt-47');
  assert.match(r.body, /<link rel="stylesheet" href="\/cms\/post-extras\.css">\n<\/head>/);
  assert.match(r.body, /<script src="\/cms\/post-extras\.js"><\/script>\n<\/body>/);
});

test('사진 묶음이 원래 있는 글은 보충 파일을 넣지 않음', async () => {
  const r = await renderWith(() => {}, 'post=minami');
  assert.doesNotMatch(r.body, /post-extras/);
});

test('갤러리: 새 사진 추가, 삭제 사진 제외', async () => {
  const r = await renderWith(d => {
    d.gallery.push({ pane: 'daily', src: 'https://x.public.blob.vercel-storage.com/a.jpg', title: '새 사진', caption: '🏫 새 사진', alt: '', big: false, sort: -1 });
    d.gallery.find(g => g.pane === 'france').deleted_at = '2026-11-05';
  }, 'page=gallery');
  assert.match(r.body, /data-gallery="daily" data-title="새 사진">\s*<img loading="lazy" src="https:\/\/x\.public\.blob\.vercel-storage\.com\/a\.jpg"/);
  const france = r.body.split('data-cms-list="gallery:france"')[1].split('<!-- BROADCAST -->')[0];
  assert.equal((france.match(/photo-item/g) || []).length, base.gallery.filter(g => g.pane === 'france').length - 1);
});

test('잘못된 이미지 주소(javascript:)는 무시', async () => {
  const r = await renderWith(d => { d.gallery[0].src = 'javascript:alert(1)'; }, 'page=gallery');
  assert.doesNotMatch(r.body, /javascript:alert/);
});

test('DB 미설정 시 원본 그대로', async () => {
  const saved = process.env.CMS_LOCAL_DATA;
  delete process.env.CMS_LOCAL_DATA;
  let body = '';
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { body = b; } };
  await handler({ url: '/api/render?page=greeting' }, res);
  process.env.CMS_LOCAL_DATA = saved;
  const { readFileSync } = await import('node:fs');
  assert.equal(body, readFileSync(join(ROOT, 'greeting.html'), 'utf8'));
  assert.equal(res.headers['X-CMS'], 'static');
});
