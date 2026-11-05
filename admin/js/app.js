// 관리자 페이지 진입점: 로그인 확인 → 화면 전환(라우팅)
import * as api from './api.js';
import { $, esc, toast, confirmBox } from './ui.js';
import { renderLogin, renderRecover, renderSetup, renderLinkError } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderPosts, renderPostEdit } from './views/posts.js';
import { renderGallery } from './views/gallery.js';
import { renderPages, renderPageEdit } from './views/pages.js';
import { renderHistory } from './views/history.js';
import { renderAccount } from './views/account.js';

const NAV = [
  { v: 'dashboard', label: '홈', icon: '🏠' },
  { v: 'posts', label: '도장 소식', icon: '📰' },
  { v: 'gallery', label: '갤러리', icon: '📸' },
  { v: 'pages', label: '페이지 문구·사진', icon: '📝' },
  { v: 'history', label: '변경 기록', icon: '🕘' },
  { v: 'account', label: '계정 설정', icon: '⚙️' },
];

const VIEWS = {
  dashboard: renderDashboard,
  posts: renderPosts,
  post: renderPostEdit,
  gallery: renderGallery,
  pages: renderPages,
  page: renderPageEdit,
  history: renderHistory,
  account: renderAccount,
};

/* ── 저장하지 않은 변경 보호 ─────────────────────────────── */
let dirty = false;
export function setDirty(on) { dirty = on; }
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

async function leaveOk() {
  if (!dirty) return true;
  const ok = await confirmBox('저장하지 않은 내용', '저장하지 않은 수정 내용이 있습니다.\n저장하지 않고 이동할까요?', '저장하지 않고 이동', true);
  if (ok) dirty = false;
  return ok;
}

/* ── 라우팅 (?v=화면&id=...) ─────────────────────────────── */
export async function go(v, params = {}, { replace = false } = {}) {
  if (!(await leaveOk())) return;
  const qs = new URLSearchParams({ v, ...params });
  history[replace ? 'replaceState' : 'pushState'](null, '', `/admin/?${qs}`);
  route();
}

window.addEventListener('popstate', async () => {
  if (dirty && !(await leaveOk())) { history.go(1); return; }
  route();
});

async function route() {
  const user = await api.me();
  if (!user) { dirty = false; return renderLogin($('#app'), onSignedIn); }
  const p = new URLSearchParams(location.search);
  const v = VIEWS[p.get('v')] ? p.get('v') : 'dashboard';
  shell(user, v === 'post' ? 'posts' : v === 'page' ? 'pages' : v);
  // 화면마다 새 요소로 교체 (이전 화면의 이벤트가 남지 않도록)
  const old = $('#main');
  const main = old.cloneNode(false);
  old.replaceWith(main);
  main.innerHTML = '<div class="loading"><span class="spinner"></span> 불러오는 중…</div>';
  window.scrollTo(0, 0);
  try {
    await VIEWS[v](main, Object.fromEntries(p));
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card error-box"><h2>화면을 불러오지 못했습니다</h2><p>${esc(err.message)}</p><button class="btn btn-primary" onclick="location.reload()">다시 시도</button></div>`;
  }
}

function shell(user, active) {
  if (!$('#main')) {
    const local = /^(localhost|127.0.0.1)$/.test(location.hostname);
    $('#app').innerHTML = `
      ${local ? '<div class="env-banner">로컬 테스트 환경입니다 — 여기서 수정한 내용은 실제 홈페이지에 반영되지 않습니다</div>' : ''}
      <header class="topbar">
        <button class="menu-btn" aria-label="메뉴 열기">☰</button>
        <a class="brand" href="/admin/?v=dashboard" data-nav="dashboard"><img src="/logo-01.png" alt="차 태권도"><span>홈페이지 관리</span></a>
        <div class="topbar-right">
          <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">홈페이지 보기 ↗</a>
          <button class="btn btn-ghost btn-sm logout-btn">로그아웃</button>
        </div>
      </header>
      <div class="layout">
        <nav class="sidebar" aria-label="관리 메뉴">
          ${NAV.map(n => `<a href="/admin/?v=${n.v}" data-nav="${n.v}"><span class="ico">${n.icon}</span>${n.label}</a>`).join('')}
          <div class="sidebar-user">아이디: ${esc(user.username)}</div>
        </nav>
        <main id="main" tabindex="-1"></main>
      </div>`;
    $('#app').addEventListener('click', e => {
      const a = e.target.closest('a[data-nav]');
      if (a && !e.ctrlKey && !e.metaKey) { e.preventDefault(); document.body.classList.remove('nav-open'); go(a.dataset.nav); }
    });
    $('.menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
    $('.logout-btn').addEventListener('click', async () => {
      if (!(await leaveOk())) return;
      await api.logout().catch(() => {});
      toast('로그아웃되었습니다.');
      location.href = '/admin/';
    });
  }
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.nav === active));
}

function onSignedIn() {
  history.replaceState(null, '', '/admin/?v=dashboard');
  route();
}

/* ── 시작 ─────────────────────────────────────────────── */
(async function boot() {
  const app = $('#app');
  // 다른 화면 사용 중 로그인이 만료되면 로그인 화면으로
  api.setUnauthorizedHandler(() => {
    if (!$('#main')) return;
    dirty = false;
    toast('로그인이 만료되었습니다. 다시 로그인해 주세요.', 'error', 6000);
    renderLogin(app, onSignedIn);
  });
  try {
    const s = await api.status();
    if (!s.configured) throw new Error('not-configured');
  } catch {
    app.innerHTML = `<div class="auth-wrap"><div class="card auth-card"><h1>설정이 필요합니다</h1><p>관리자 시스템이 아직 연결되지 않았습니다. 개발자에게 문의해 주세요.</p></div></div>`;
    return;
  }
  const p = new URLSearchParams(location.search);
  // 개발자가 보낸 비밀번호 설정 링크: /admin/?setup=토큰
  const token = p.get('setup');
  if (token) {
    history.replaceState(null, '', '/admin/'); // 주소창·방문 기록에 토큰이 남지 않도록
    const { valid } = await api.checkSetupToken(token).catch(() => ({ valid: false }));
    return valid ? renderSetup(app, token, onSignedIn) : renderLinkError(app);
  }
  if (p.get('v') === 'recover') return renderRecover(app, onSignedIn);
  route();
})();
