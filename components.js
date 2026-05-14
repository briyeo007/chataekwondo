// Shared header/footer for all pages
const CURRENT_PAGE = document.body.dataset.page || '';

const LOGO_HTML = `
  <a href="index.html" class="logo">
    <img src="https://chataekwondo.com/wp-content/uploads/2025/05/logo-01.png" alt="차 태권도" class="logo-img" />
  </a>
`;

const NAV_ITEMS = [
  { label: 'HOME', href: 'index.html', key: 'home' },
  {
    label: '도장 소개', key: 'about', dropdown: [
      { label: '관장님 인사말', href: 'greeting.html', key: 'greeting' },
      { label: '차 태권도의 철학 및 교육 목표', href: 'philosophy.html', key: 'philosophy' },
      { label: '도장 시설 안내', href: 'facility.html', key: 'facility' },
      { label: '오시는 길', href: 'directions.html', key: 'directions' },
    ]
  },
  { label: '도장 소식', href: 'news.html', key: 'news' },
];

function buildNav() {
  return NAV_ITEMS.map(item => {
    if (item.dropdown) {
      const isActive = item.dropdown.some(d => d.key === CURRENT_PAGE);
      return `
        <li class="has-dropdown${isActive ? ' active' : ''}">
          <a href="#">${item.label} <span class="arrow">▾</span></a>
          <ul class="dropdown">
            ${item.dropdown.map(d => `
              <li><a href="${d.href}" class="${d.key === CURRENT_PAGE ? 'current' : ''}">${d.label}</a></li>
            `).join('')}
          </ul>
        </li>`;
    }
    return `<li class="${item.key === CURRENT_PAGE ? 'active' : ''}">
      <a href="${item.href}">${item.label}</a>
    </li>`;
  }).join('');
}

function buildMobileNav() {
  const items = [];
  NAV_ITEMS.forEach(item => {
    if (item.dropdown) {
      item.dropdown.forEach(d => {
        items.push(`<li><a href="${d.href}" class="${d.key === CURRENT_PAGE ? 'current' : ''}">${d.label}</a></li>`);
      });
    } else {
      items.push(`<li><a href="${item.href}" class="${item.key === CURRENT_PAGE ? 'current' : ''}">${item.label}</a></li>`);
    }
  });
  return items.join('');
}

const HEADER_HTML = `
<header class="header" id="header">
  <div class="header-inner">
    ${LOGO_HTML}
    <nav class="nav">
      <ul class="nav-list">${buildNav()}</ul>
    </nav>
    <button class="hamburger" id="hamburger" aria-label="메뉴">
      <span></span><span></span><span></span>
    </button>
  </div>
</header>
<div class="mobile-menu" id="mobileMenu">
  <ul>${buildMobileNav()}</ul>
</div>
`;

const FOOTER_HTML = `
<footer class="footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-logo">
        <a href="index.html">
          <img src="https://chataekwondo.com/wp-content/uploads/2025/05/logo-01.png" alt="차 태권도" class="footer-logo-img" />
        </a>
      </div>
      <div class="footer-links">
        <a href="greeting.html">관장님 인사말</a>
        <a href="philosophy.html">철학 및 교육 목표</a>
        <a href="facility.html">도장 시설 안내</a>
        <a href="directions.html">오시는 길</a>
        <a href="news.html">도장 소식</a>
      </div>
      <div class="footer-contact">
        <p>강남점: 서울시 서초구 사임당로 158, 리더스원 빌딩 4F &nbsp;|&nbsp; 010-3180-9209</p>
        <p>서초점: 서울시 서초구 남부순환로339길 33, 송하 빌딩 2F &nbsp;|&nbsp; 010-4952-9397</p>
      </div>
      <div class="footer-copy">
        <p>&copy; 2026 CHA Taekwondo. All rights reserved.</p>
      </div>
    </div>
  </div>
</footer>
`;

// Inject on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Header
  const headerEl = document.getElementById('site-header');
  if (headerEl) headerEl.innerHTML = HEADER_HTML;

  // Footer
  const footerEl = document.getElementById('site-footer');
  if (footerEl) footerEl.innerHTML = FOOTER_HTML;

  // Hamburger menu
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => mobileMenu.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
        mobileMenu.classList.remove('open');
      }
    });
  }

  // Header scroll effect
  const header = document.getElementById('header');
  if (header) {
    window.addEventListener('scroll', () => {
      header.classList.toggle('scrolled', window.scrollY > 50);
    });
  }

  // Scroll reveal
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
});
