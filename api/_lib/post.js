// 도장 소식 글 페이지 렌더링.
// 기존 post-*.html 파일은 각자 자기 디자인을 그대로 템플릿으로 사용하고,
// 새 글은 api/_lib/post-template.html 을 사용한다.
// 교체 영역: <title>, 분류, 제목, 날짜, 대표 사진, 본문, 본문 아래 영역(블로그 링크·사진).
import {
  parseDoc, findFirst, hasClass, getAttr, innerRange, attrReplacement,
  applyReplacements, htmlToText, textToHtml, escapeHtml,
} from './html.js';
import { koDate } from './lists.js';
import { safeUrl } from './sanitize.js';

const SITE_SUFFIX = ' – 차 태권도';

function locate(html) {
  const doc = parseDoc(html);
  const by = (tag, cls) => findFirst(doc, n => n.tagName === tag && (!cls || hasClass(n, cls)));
  const byClass = cls => findFirst(doc, n => hasClass(n, cls));
  const body = byClass('article-body');
  const backBtn = byClass('back-btn');
  const wrap = byClass('article-wrap');
  let after = null;
  if (body) {
    const start = body.sourceCodeLocation.endOffset;
    const end = backBtn ? backBtn.sourceCodeLocation.startOffset
      : wrap ? innerRange(wrap).end : start;
    after = { start, end };
  }
  return {
    title: by('title'),
    cat: byClass('article-cat'),
    h1: byClass('article-title'),
    meta: byClass('article-meta'),
    hero: findFirst(doc, n => n.tagName === 'img' && hasClass(n, 'article-hero')),
    body,
    after,
    head: by('head'),
    bodyTag: by('body'),
  };
}

export const metaText = p => p.meta_text || `${koDate(p.published_on)} · 차 태권도`;
export const seoTitle = p => p.seo_title || `${p.title}${SITE_SUFFIX}`;

function keepWs(orig, text) {
  return orig.match(/^\s*/)[0] + text + orig.match(/\s*$/)[0];
}

// 본문 아래 영역이 쓰는 컴포넌트 CSS가 템플릿에 없으면 보충 파일을 넣는다
const EXTRA_CLASSES = ['gallery-grid', 'blog-banner', 'video-embed'];

export function renderPost(html, p, sanitize) {
  const L = locate(html);
  const reps = [];
  const inner = (el, text) => { const r = el && innerRange(el); if (r) reps.push({ ...r, text }); };

  inner(L.title, escapeHtml(seoTitle(p)));
  inner(L.cat, escapeHtml(p.category));
  inner(L.h1, escapeHtml(p.title));
  inner(L.meta, escapeHtml(metaText(p)));
  if (L.hero) {
    const src = safeUrl(p.cover_url);
    if (src) {
      reps.push(attrReplacement(html, L.hero, 'src', src));
      reps.push(attrReplacement(html, L.hero, 'alt', p.cover_alt || p.title));
    } else {
      const loc = L.hero.sourceCodeLocation;
      reps.push({ start: loc.startOffset, end: loc.endOffset, text: '' });
    }
  }
  const bodyHtml = sanitize(p.body_html);
  const afterHtml = sanitize(p.after_html);
  if (L.body) {
    const r = innerRange(L.body);
    reps.push({ ...r, text: keepWs(html.slice(r.start, r.end), bodyHtml) });
  }
  if (L.after) {
    const orig = html.slice(L.after.start, L.after.end);
    reps.push({ ...L.after, text: afterHtml ? `\n\n    ${afterHtml}\n\n    ` : orig.match(/\s*$/)[0] || '\n    ' });
  }

  // 템플릿에 없는 컴포넌트 CSS/JS 보충
  const styleText = html.slice(0, L.head ? L.head.sourceCodeLocation.endOffset : 0);
  const used = bodyHtml + afterHtml;
  const needCss = EXTRA_CLASSES.some(c => used.includes(c) && !styleText.includes('.' + c));
  const needJs = used.includes('gallery-grid') && !html.includes('id="lightbox"');
  if (needCss && L.head) {
    const pos = L.head.sourceCodeLocation.endTag.startOffset;
    reps.push({ start: pos, end: pos, text: '  <link rel="stylesheet" href="/cms/post-extras.css">\n' });
  }
  if (needJs && L.bodyTag?.sourceCodeLocation.endTag) {
    const pos = L.bodyTag.sourceCodeLocation.endTag.startOffset;
    reps.push({ start: pos, end: pos, text: '<script src="/cms/post-extras.js"></script>\n' });
  }
  return applyReplacements(html, reps);
}

/** 초기 이전용: 기존 글 파일에서 글 데이터를 추출 */
export function extractPost(html) {
  const L = locate(html);
  const text = el => { const r = el && innerRange(el); return r ? htmlToText(html.slice(r.start, r.end)) : ''; };
  const raw = r => (r ? html.slice(r.start, r.end).trim() : '');
  return {
    seo_title: text(L.title),
    category: text(L.cat),
    title: text(L.h1),
    meta_text: text(L.meta),
    cover_url: L.hero ? getAttr(L.hero, 'src') || '' : '',
    cover_alt: L.hero ? getAttr(L.hero, 'alt') || '' : '',
    body_html: raw(L.body && innerRange(L.body)),
    after_html: raw(L.after),
  };
}

export { textToHtml };
