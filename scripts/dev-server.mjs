// 로컬 개발 서버: vercel.json 의 routes 규칙을 그대로 흉내 내어 운영과 같은 방식으로 동작한다.
//   npm run dev                      → 로컬 테스트 저장소(.cms/store) 사용. 관리자·동기화 기능 전체를 내 PC에서 시험
//   npm run dev -- --env .env.vercel → 지정한 환경변수 파일 사용 (예: vercel env pull 로 받은 운영 저장소 — 주의!)
//   npm run dev -- --offline         → 저장소 없이, 현재 HTML에서 추출한 데이터로 렌더링 (디자인 확인용)
//   npm run dev -- --static          → 원본 HTML 그대로 (기존 서버시작.bat 와 동일)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, extractAll } from './lib/extract.mjs';

const args = process.argv.slice(2);
const PORT = Number(process.env.PORT || 3000);
const envArg = args.includes('--env') ? args[args.indexOf('--env') + 1] : null;

if (args.includes('--static')) {
  console.log('모드: 정적 (원본 HTML)');
} else if (args.includes('--offline')) {
  mkdirSync(join(ROOT, '.cms'), { recursive: true });
  const file = join(ROOT, '.cms', 'offline-data.json');
  writeFileSync(file, JSON.stringify(extractAll()));
  process.env.CMS_LOCAL_DATA = file;
  console.log('모드: 오프라인 (HTML에서 추출한 데이터)');
} else if (envArg) {
  process.loadEnvFile(envArg);
  console.log(`모드: ${envArg} 의 저장소 사용 ⚠ 운영 저장소라면 실제 홈페이지 콘텐츠가 바뀝니다`);
} else {
  // 로컬 테스트 저장소 + 테스트용 비밀값 자동 생성
  const dir = join(ROOT, '.cms');
  const envFile = join(dir, 'dev.env');
  mkdirSync(dir, { recursive: true });
  if (!existsSync(envFile)) {
    const r = () => randomBytes(32).toString('base64url');
    writeFileSync(envFile, `CMS_SITE_URL=http://localhost:${PORT}\nCMS_SYNC_TOKEN=${r()}\nSESSION_SECRET=${r()}\nBACKUP_KEY=${r()}\nCMS_STORE_DIR=${join(dir, 'store').replace(/\\/g, '/')}\n`);
  }
  process.loadEnvFile(envFile);
  console.log(`모드: 로컬 테스트 저장소 (${process.env.CMS_STORE_DIR})`);
  console.log('      동기화·명령 테스트: --env .cms/dev.env 옵션 사용 (예: npm run cms:seed -- --env .cms/dev.env)');
}

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const handlers = {
  '/api/render': (await import('../api/render.js')).default,
  '/api/admin': (await import('../api/admin.js')).default,
  '/api/sync': (await import('../api/sync.js')).default,
};
const { readLocalMedia } = await import('../api/_lib/media.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

function serveFile(res, path) {
  const abs = normalize(join(ROOT, decodeURIComponent(path)));
  const rel = abs.slice(normalize(ROOT).length);
  // 배포에서 제외되는 파일(.vercelignore)과 숨김 파일은 로컬에서도 열지 않음
  if (!abs.startsWith(normalize(ROOT)) || /(^|[\\/])\./.test(rel) || /^[\\/]?(node_modules|scripts|docs|content)([\\/]|$)/.test(rel)) return false;
  let file = abs;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return false;
  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
  res.end(readFileSync(file));
  return true;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let path = url.pathname;
  const params = new URLSearchParams(url.search);
  try {
    // 로컬 테스트 저장소의 사진 (운영에서는 Vercel Blob 주소)
    if (path.startsWith('/cms-media/')) {
      const buf = readLocalMedia(decodeURIComponent(path.slice('/cms-media/'.length)));
      if (!buf) { res.statusCode = 404; return res.end('Not found'); }
      res.setHeader('Content-Type', MIME[extname(path).toLowerCase()] || 'application/octet-stream');
      return res.end(buf);
    }
    for (const r of vercel.routes) {
      if (r.handle === 'filesystem') break;
      const m = path.match(new RegExp(`^${r.src}$`));
      if (!m) continue;
      if (r.headers) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
      if (r.status) { res.statusCode = r.status; return res.end('Not found'); }
      if (r.dest) {
        const dest = r.dest.replace(/\$(\d)/g, (_, i) => m[+i] || '');
        const [p, q] = dest.split('?');
        path = p;
        for (const [k, v] of new URLSearchParams(q || '')) params.set(k, v); // Vercel처럼 원래 쿼리와 합침
        break;
      }
      if (!r.continue) break;
    }
    if (handlers[path]) {
      req.url = `${path}?${params}`;
      return await handlers[path](req, res);
    }
    if (!serveFile(res, path)) { res.statusCode = 404; res.end('Not found'); }
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('Server error');
  }
}).listen(PORT, () => console.log(`▶ http://localhost:${PORT}  (관리자: http://localhost:${PORT}/admin/)`));
