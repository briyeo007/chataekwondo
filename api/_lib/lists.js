// DB 데이터로 목록 HTML(소식 카드, 메인 최근 소식, 갤러리)을 생성한다.
// 마크업은 기존 HTML과 동일하게 맞춰 두었다. 디자인을 바꿀 때는 이 파일도 함께 수정한다.
import { escapeHtml as h, escapeAttr as a } from './html.js';
import { safeUrl } from './sanitize.js';

export function postUrl(p) {
  return `post-${p.slug}.html`;
}

function ymd(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  return { y, m, d };
}
export const dotDate = s => { const { y, m, d } = ymd(s); return `${y}. ${String(m).padStart(2, '0')}. ${String(d).padStart(2, '0')}`; };
export const koDate = s => { const { y, m, d } = ymd(s); return `${y}년 ${m}월 ${d}일`; };

const cardImage = p => safeUrl(p.card_image_url || p.cover_url);
const cardAlt = p => (p.card_image_url ? p.card_image_alt : p.cover_alt) || p.title;
const cardTitle = p => p.list_title || p.title;
const cardBadge = p => p.list_category || p.category;

/** news.html 카드 목록 */
export function newsCards(posts) {
  const cards = posts.map((p, i) => `
    <a href="${a(postUrl(p))}" class="news-card${i === 0 ? ' featured' : ''}">
      <div class="news-card-img">
        <img src="${a(cardImage(p))}" alt="${a(cardAlt(p))}" loading="lazy">
      </div>
      <div class="news-card-body">
        <div class="news-card-meta">
          <span class="news-card-date">${h(dotDate(p.published_on))}</span>
          <span class="news-card-badge">${h(cardBadge(p))}</span>
        </div>
        <h2 class="news-card-title">${h(cardTitle(p))}</h2>
        <p class="news-card-excerpt">${h(p.excerpt)}</p>
        <span class="news-card-link">자세히 보기</span>
      </div>
    </a>
`).join('');
  return `\n${cards}\n  `;
}

/** index.html "최근 도장 소식" 카드 (최신 6개) */
export function indexNewsCards(posts) {
  const cards = posts.slice(0, 6).map(p => `
      <a href="${a(postUrl(p))}" style="background:#fff;border-radius:12px;overflow:hidden;text-decoration:none;display:block;box-shadow:0 2px 12px rgba(0,0,0,.07);">
        <img loading="lazy" src="${a(cardImage(p))}" alt="${a(cardAlt(p))}" style="width:100%;aspect-ratio:16/9;object-fit:cover;">
        <div style="padding:18px;"><span style="font-size:11px;font-weight:700;color:#fcaf3b;letter-spacing:1px;">도장소식</span><h3 style="font-size:15px;font-weight:700;color:#14171c;margin:8px 0 6px;line-height:1.5;">${h(cardTitle(p))}</h3><span style="font-size:12px;color:#aaa;">${h(koDate(p.published_on))}</span></div>
      </a>`).join('');
  return `${cards}\n    `;
}

/** gallery.html 탭별 사진 */
export function galleryItems(items, pane) {
  const out = items.map(it => {
    const src = safeUrl(it.src);
    return `
        <a href="${a(src)}" class="glightbox photo-item${it.big ? ' big' : ''}" data-gallery="${a(pane)}" data-title="${a(it.title)}">
          <img loading="lazy" src="${a(src)}" alt="${a(it.alt ?? it.caption)}">
          <div class="zoom-icon">🔍</div>
          <div class="photo-caption">${h(it.caption)}</div>
        </a>`;
  }).join('');
  return `${out}\n      `;
}

export const GALLERY_PANES = ['all', 'france', 'broadcast', 'exam', 'daily'];
