// 관리자가 입력한 HTML을 방문자에게 보내기 전에 정화한다 (XSS 방지).
// 스크립트, 이벤트 속성(onclick 등), javascript: 링크는 모두 제거되고
// 유튜브 외의 iframe은 허용하지 않는다.
import sanitizeHtml from 'sanitize-html';

const OPTIONS = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'div', 'a', 'img',
    'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'cite', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'iframe',
  ],
  allowedAttributes: {
    '*': ['class', 'style', 'id'],
    a: ['href', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'loading', 'width', 'height'],
    iframe: ['src', 'title', 'allow', 'allowfullscreen', 'loading', 'frameborder', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com', 'youtube.com'],
  allowIframeRelativeUrls: false,
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target === '_blank') attribs.rel = 'noopener';
      return { tagName, attribs };
    },
  },
  // 원본의 <br>, <img> 표기를 HTML5 형태로 유지
  selfClosing: ['br', 'img', 'hr'],
};

export function sanitize(html) {
  return sanitizeHtml(String(html ?? ''), OPTIONS);
}

/** 이미지·링크 URL 검증: http(s) 또는 사이트 내부 경로만 허용 */
export function safeUrl(url) {
  const s = String(url ?? '').trim();
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}
