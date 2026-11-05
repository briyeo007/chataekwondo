// 화면 비교: 두 서버(원본 / CMS 렌더링)의 같은 페이지를 실제 브라우저로 찍어 픽셀 단위로 비교한다.
//   node scripts/visual-compare.mjs http://localhost:3001 http://localhost:3000
// 외부 리소스(유튜브·지도·구글폼)는 결과가 매번 달라지므로 차단하고, 애니메이션은 끈다.
// 결과 이미지: .cms/visual/
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT, CMS_PAGES } from './lib/extract.mjs';
import { readdirSync } from 'node:fs';

const [A, B] = process.argv.slice(2);
if (!A || !B) { console.error('사용법: node scripts/visual-compare.mjs <원본서버> <비교서버>'); process.exit(1); }
const OUT = join(ROOT, '.cms', 'visual');
mkdirSync(OUT, { recursive: true });

const pages = [...CMS_PAGES.map(p => `/${p}.html`), ...readdirSync(ROOT).filter(f => /^post-.+\.html$/.test(f) && f !== 'post-register-form.html').map(f => `/${f}`)];
const VIEWPORTS = { pc: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
const ALLOW = [/^http:\/\/localhost/, /fonts\.(googleapis|gstatic)\.com/, /cdn\.jsdelivr\.net/, /unpkg\.com/];

const browser = await chromium.launch();
let fails = 0;
for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.route('**/*', route => (ALLOW.some(r => r.test(route.request().url())) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  const shot = async (base, path) => {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    // 스크롤 등장 효과를 모두 보이게 하고, 숫자 카운터 애니메이션을 최종값으로
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}.cha-reveal{opacity:1!important;transform:none!important}' });
    await page.evaluate(() => {
      document.querySelectorAll('.cha-reveal').forEach(e => e.classList.add('cha-visible'));
      document.querySelectorAll('.num[data-target]').forEach(e => { e.textContent = e.dataset.target; });
      document.querySelectorAll('img[loading=lazy]').forEach(i => { i.loading = 'eager'; });
    });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
    return page.screenshot({ fullPage: true });
  };
  for (const p of pages) {
    const a = await shot(A, p);
    const b = await shot(B, p);
    const name = `${vpName}${p.replace(/[/.]/g, '_')}`;
    if (Buffer.compare(a, b) === 0) { console.log(`✓ ${vpName.padEnd(6)} ${p}`); continue; }
    // PNG가 다르면 픽셀 비교
    const diff = await page.evaluate(async ([x, y]) => {
      const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
      const c = new OffscreenCanvas(ia.width, ia.height).getContext('2d');
      c.drawImage(ia, 0, 0); const da = c.getImageData(0, 0, ia.width, ia.height).data;
      c.drawImage(ib, 0, 0); const db = c.getImageData(0, 0, ib.width, ib.height).data;
      let n = 0, firstY = -1;
      for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) { n++; if (firstY < 0) firstY = Math.floor(i / 4 / ia.width); }
      return { n, firstY };
    }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
    if (diff.n === 0) { console.log(`✓ ${vpName.padEnd(6)} ${p}`); continue; }
    fails++;
    writeFileSync(join(OUT, `${name}-A.png`), a);
    writeFileSync(join(OUT, `${name}-B.png`), b);
    console.log(`✗ ${vpName.padEnd(6)} ${p}  ${diff.size ? `크기 다름 ${diff.size}` : `다른 픽셀 ${diff.n}개 (첫 위치 y=${diff.firstY})`}`);
  }
  await ctx.close();
}
await browser.close();
console.log(fails ? `\n차이 ${fails}건 → .cms/visual/ 이미지 확인` : '\n모든 화면 픽셀 동일');
process.exit(fails ? 1 : 0);
