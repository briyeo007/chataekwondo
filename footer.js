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
      align-items: start;
    }
    @media (max-width: 820px) {
      .cha-footer-top { grid-template-columns: 1fr; gap: 28px; text-align: center; }
      .cha-footer-social { align-items: center; }
    }
    .cha-footer-logo { height: 44px; margin-bottom: 12px; display: block; }
    @media (max-width: 820px) { .cha-footer-logo { margin: 0 auto 12px; } }
    .cha-footer-director { font-weight: 700; color: #fff; font-size: 14px; }
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
     - YouTube URL   (현재 #)
     - 사업자등록번호  (현재 000-00-00000)
     - 개인정보 처리방침 링크 (현재 #)
  */
  var html = `
    <footer class="cha-footer-unified">
      <div class="cha-footer-top">

        <div class="cha-footer-brand">
          <img src="https://chataekwondo.com/wp-content/uploads/2025/05/logo-01.png"
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
          <p class="legal">
            사업자등록번호: 000-00-00000 &nbsp;|&nbsp;
            <a href="#">개인정보 처리방침</a>
          </p>
        </div>

        <div class="cha-footer-social">
          <a href="#" target="_blank" class="cha-soc-btn insta">📸 Instagram</a>
          <a href="#" target="_blank" class="cha-soc-btn yt">▶ YouTube</a>
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
