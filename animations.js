(function () {
  /* ── CSS ── */
  var css = `
    /* 기본 숨김 상태 */
    .cha-reveal {
      opacity: 0;
      transform: translateY(36px);
      transition: opacity 0.65s cubic-bezier(.25,.46,.45,.94),
                  transform 0.65s cubic-bezier(.25,.46,.45,.94);
    }
    .cha-reveal.cha-visible {
      opacity: 1;
      transform: none;
    }

    /* 히어로 섹션 로드 애니메이션 */
    .page-hero .kicker  { animation: cha-fade-up 0.6s ease both 0.15s; }
    .page-hero h1       { animation: cha-fade-up 0.6s ease both 0.3s;  }
    .page-hero > p      { animation: cha-fade-up 0.6s ease both 0.45s; }
    .page-hero .hero-actions,
    .page-hero a.btn,
    .page-hero .cha-hero-btns { animation: cha-fade-up 0.6s ease both 0.6s; }

    @keyframes cha-fade-up {
      from { opacity: 0; transform: translateY(24px); }
      to   { opacity: 1; transform: none; }
    }
  `;

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ── 스크롤 reveal 대상 셀렉터 ── */
  var SCROLL_SELECTORS = [
    /* 섹션 타이틀 */
    '.section-title',
    '.section-sub',
    '.kicker:not(.page-hero .kicker)',

    /* 인덱스 카드류 */
    '.cha-review-card',
    '.cha-map-card',

    /* 오시는길 */
    '.loc-card',
    '.quick-bar',

    /* wp-block 섹션 (집중력/글로벌/호신술) */
    '.wp-block-cover .wp-block-columns',
    '.wp-block-cover h2.wp-block-heading',
    '.wp-block-cover > .wp-block-cover__inner-container > p',

    /* 내부 페이지 (greeting, philosophy, facility, instructor) */
    '.page-content > h1',
    '.page-content > h2',
    '.page-content > h3',
    '.page-content > p',
    '.page-content > figure',
    '.page-content > ul',
    '.page-content > blockquote',

    /* 수련 프로그램 */
    '.prog-grid',
    '.prog-badge',

    /* 갤러리 */
    '.photo-grid > a',
    '.cat-tabs',

    /* 공통 CTA 섹션 */
    '.cta-section',
    '.cta-section h2',
    '.cta-section p',
    '.cta-section a',
  ];

  /* ── 그룹별 stagger (형제 요소에 딜레이) ── */
  var STAGGER_GROUPS = [
    '.cha-reviews-grid',
    '.cha-map-grid',
    '.location-grid',
    '.photo-grid',
  ];

  /* ── 제외 컨테이너 ── */
  function isExcluded(el) {
    return !!el.closest(
      'header, footer, nav, .cha-header, .cha-footer-unified, .cha-sticky-bar'
    );
  }

  /* ── reveal 클래스 부여 ── */
  var seen = new WeakSet();

  SCROLL_SELECTORS.forEach(function (sel) {
    try {
      document.querySelectorAll(sel).forEach(function (el) {
        if (seen.has(el) || isExcluded(el)) return;
        seen.add(el);
        el.classList.add('cha-reveal');
      });
    } catch (e) {}
  });

  /* stagger 딜레이 적용 */
  STAGGER_GROUPS.forEach(function (groupSel) {
    document.querySelectorAll(groupSel).forEach(function (container) {
      var children = container.children;
      Array.prototype.forEach.call(children, function (child, i) {
        if (!seen.has(child) && !isExcluded(child)) {
          seen.add(child);
          child.classList.add('cha-reveal');
        }
        child.style.transitionDelay = (i * 0.13) + 's';
      });
    });
  });

  /* ── IntersectionObserver ── */
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('cha-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.cha-reveal').forEach(function (el) {
    observer.observe(el);
  });
})();
