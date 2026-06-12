(function () {
  /* ── CSS ──────────────────────────────────────────────────────────────── */
  var css = `
    .cha-footer-unified {
      background: #14171c;
      color: rgba(255,255,255,.55);
      padding: 56px 24px 32px;
      font-size: 13px;
      line-height: 1.9;
      font-family: 'Outfit', sans-serif;
    }
    .cha-footer-unified a { color: #fcaf3b; text-decoration: none; }
    .cha-footer-top {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 48px;
      max-width: 1100px;
      margin: 0 auto;
      align-items: center;
    }
    @media (max-width: 820px) {
      .cha-footer-top { grid-template-columns: 1fr; gap: 28px; text-align: center; }
      .cha-footer-social { align-items: center; }
    }
    .cha-footer-logo { height: 44px; margin-bottom: 12px; display: block; }
    @media (max-width: 820px) { .cha-footer-logo { margin: 0 auto 12px; } }
    .cha-footer-director { font-weight: 700; color: #fff; font-size: 14px; margin: 0; }
    .cha-footer-info p { margin-bottom: 6px; }
    .cha-footer-info .legal { margin-top: 12px; font-size: 12px; opacity: .65; }
    .cha-footer-social { display: flex; flex-direction: column; gap: 8px; min-width: 148px; }
    .cha-soc-btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 9px 16px; border-radius: 8px;
      font-size: 13px; font-weight: 700;
      text-decoration: none; transition: opacity .2s;
    }
    .cha-soc-btn:hover { opacity: .82; }
    .cha-soc-btn.insta  { background: #e1306c; color: #fff; }
    .cha-soc-btn.yt     { background: #ff0000; color: #fff; }
    .cha-soc-btn.naver  { background: #03c75a; color: #fff; }
    .cha-footer-divider {
      border: none; border-top: 1px solid rgba(255,255,255,.1);
      margin: 32px auto 0; max-width: 1100px;
    }
    .cha-footer-bottom {
      text-align: center; color: rgba(255,255,255,.35);
      font-size: 12px; padding-top: 20px;
      max-width: 1100px; margin: 0 auto;
    }
  `;

  /* ── HTML ─────────────────────────────────────────────────────────────── */
  /* 수정이 필요한 항목:
     - Instagram URL (현재 #)
     - YouTube URL   (완료)
     - 사업자등록번호  (현재 000-00-00000)
     - 개인정보 처리방침 링크 (현재 #)
  */
  var html = `
    <footer class="cha-footer-unified">
      <div class="cha-footer-top">

        <div class="cha-footer-brand">
          <img src="/logo-01.png"
               alt="차 태권도" class="cha-footer-logo">
          <p class="cha-footer-director">관장 차동술</p>
        </div>

        <div class="cha-footer-info">
          <p>
            <strong style="color:#fff;">🔵 차 태권도 블루관</strong>&nbsp;
            서울시 서초구 사임당로 158, 래미안리더스원 상가 4층 &nbsp;|&nbsp;
            <a href="tel:01031809209">010-3180-9209</a>
          </p>
          <p>
            <strong style="color:#fff;">🔴 차 태권도 레드관</strong>&nbsp;
            서울시 서초구 남부순환로339길 33, 송하빌딩 2층 &nbsp;|&nbsp;
            <a href="tel:01049529397">010-4952-9397</a>
          </p>
        </div>

        <div class="cha-footer-social">
          <a href="https://www.instagram.com/cha.taekwondo/" target="_blank" class="cha-soc-btn insta">📸 Instagram</a>
          <a href="https://www.youtube.com/@%EC%B0%A8%ED%83%9C%EA%B6%8C%EB%8F%84" target="_blank" class="cha-soc-btn yt">▶ YouTube</a>
          <a href="https://map.naver.com/v5/search/차+태권도+서초구+서울"
             target="_blank" class="cha-soc-btn naver">🗺 네이버 지도</a>
        </div>

      </div>
      <hr class="cha-footer-divider">
      <div class="cha-footer-bottom">
        <p>© 2026 차 태권도. All rights reserved.</p>
      </div>
    </footer>
  `;

  /* ── Inject ───────────────────────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var el = document.getElementById('cha-footer-placeholder');
  if (el) el.outerHTML = html;
})();

/* ═══════════════════════════════════════════════════════════════
   TRANSLATE — globe button + Google Translate (all pages)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  var css = `
    .cha-translate-btn {
      display: flex; align-items: center; gap: 5px;
      background: none; border: 1.5px solid #ccc; border-radius: 20px;
      padding: 5px 12px; font-size: 13px; font-weight: 600;
      cursor: pointer; color: #333; font-family: 'Outfit', sans-serif;
      transition: border-color .2s, color .2s, background .2s;
      white-space: nowrap; flex-shrink: 0;
    }
    .cha-translate-btn:hover { border-color: #fcaf3b; color: #fcaf3b; }
    .cha-translate-btn.en-active {
      border-color: #fcaf3b; color: #fcaf3b;
      background: rgba(252,175,59,.10);
    }
    .cha-translate-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
    /* Desktop: hide mobile button / Mobile: hide desktop button */
    @media (max-width: 820px) {
      .cha-translate-btn.tr-desktop { display: none !important; }
      .cha-translate-btn.tr-mobile  { display: flex; margin-left: auto; margin-right: 6px; }
    }
    @media (min-width: 821px) {
      .cha-translate-btn.tr-mobile  { display: none !important; }
    }
    .goog-te-banner-frame,
    .goog-te-banner-frame.skiptranslate { display: none !important; }
    .goog-te-gadget { display: none !important; }
    #google_translate_element { display: none !important; }
    .skiptranslate { display: none !important; }
    body { top: 0 !important; }
  `;
  var s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);

  var div = document.createElement('div');
  div.id = 'google_translate_element';
  document.body.appendChild(div);

  var SKIP_KEY = 'cha_skip_translate';
  var isEnglish = false;
  var cooldown = false;

  /* ── GT 로드 (온디맨드, 중복 방지) ── */
  function loadGT() {
    if (document.querySelector('script[src*="translate.google.com"]')) return;
    window.googleTranslateElementInit = function () {
      new google.translate.TranslateElement({
        pageLanguage: 'ko', includedLanguages: 'en', autoDisplay: false
      }, 'google_translate_element');
    };
    var s = document.createElement('script');
    s.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    s.async = true;
    document.body.appendChild(s);
  }

  /* ── EN 번역 적용 (combo 나타날 때까지 대기, 최대 5초) ── */
  function applyEN(tries) {
    tries = tries || 0;
    if (tries > 33) return;
    var select = document.querySelector('.goog-te-combo');
    if (!select) { setTimeout(function () { applyEN(tries + 1); }, 150); return; }
    select.value = 'en';
    var ev = document.createEvent('HTMLEvents');
    ev.initEvent('change', true, true);
    select.dispatchEvent(ev);
  }

  /* ── KO 복원 ── */
  function restoreKO() {
    sessionStorage.setItem(SKIP_KEY, '1');
    var exp = new Date(0).toUTCString();
    [location.hostname, '.' + location.hostname, ''].forEach(function (d) {
      var c = 'googtrans=; expires=' + exp + '; path=/';
      if (d) c += '; domain=' + d;
      document.cookie = c;
    });
    window.location.replace(window.location.pathname + window.location.search);
  }

  /* ── 페이지 로드 시: 복원 플래그 체크, 없으면 GT 미리 로드 ── */
  if (sessionStorage.getItem(SKIP_KEY)) {
    sessionStorage.removeItem(SKIP_KEY);
    // GT 스크립트 로드 안 함 → 한국어 유지
  } else {
    loadGT();
  }

  var svgGlobe =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="10"/>' +
      '<line x1="2" y1="12" x2="22" y2="12"/>' +
      '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' +
    '</svg>';

  function buildBtn(extraClass) {
    var btn = document.createElement('button');
    btn.className = 'cha-translate-btn ' + extraClass;
    btn.setAttribute('aria-label', '언어 전환');
    btn.innerHTML = svgGlobe + '<span>KO</span>';
    btn.addEventListener('click', function () {
      if (cooldown) return;           // 빠른 연속 클릭 방지
      cooldown = true;
      setTimeout(function () { cooldown = false; }, 800);

      isEnglish = !isEnglish;
      document.querySelectorAll('.cha-translate-btn').forEach(function (b) {
        b.querySelector('span').textContent = isEnglish ? 'EN' : 'KO';
        b.classList.toggle('en-active', isEnglish);
      });

      if (isEnglish) {
        loadGT();    // GT가 아직 안 로드됐으면 지금 로드
        applyEN();   // combo 나타나면 번역 적용
      } else {
        restoreKO();
      }
    });
    return btn;
  }

  function injectBtn() {
    var nav = document.querySelector('.cha-nav');
    var navLinks = document.getElementById('navLinks');
    if (!nav || document.querySelector('.cha-translate-btn')) return;

    // Desktop: inside navLinks (keeps space-between layout correct)
    if (navLinks) navLinks.appendChild(buildBtn('tr-desktop'));

    // Mobile: before hamburger button
    var hamburger = nav.querySelector('.cha-hamburger');
    if (hamburger) { nav.insertBefore(buildBtn('tr-mobile'), hamburger); }
    else { nav.appendChild(buildBtn('tr-mobile')); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBtn);
  } else {
    injectBtn();
  }
})();
