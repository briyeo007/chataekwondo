// HTML 소스 위치 기반 유틸리티.
// parse5의 sourceCodeLocation을 이용해 "원본 문자열의 특정 구간만" 교체한다.
// 교체하지 않은 부분은 원본 바이트 그대로 유지되므로 디자인이 바뀌지 않는다.
import { parse, parseFragment } from 'parse5';

export function parseDoc(html) {
  return parse(html, { sourceCodeLocationInfo: true });
}

export function parseFrag(html) {
  return parseFragment(html, { sourceCodeLocationInfo: true });
}

export function walk(node, fn) {
  if (fn(node) === false) return;
  const kids = node.childNodes || [];
  for (const k of kids) walk(k, fn);
  if (node.content) walk(node.content, fn);
}

export const getAttr = (el, name) => el.attrs?.find(a => a.name === name)?.value;
export const hasClass = (el, c) => (getAttr(el, 'class') || '').split(/\s+/).includes(c);
export const isEl = n => !!n.tagName;

export function findAll(root, pred) {
  const out = [];
  walk(root, n => { if (isEl(n) && pred(n)) out.push(n); });
  return out;
}
export const findFirst = (root, pred) => findAll(root, pred)[0];

/** 요소의 내부(innerHTML) 범위. 닫는 태그가 없으면 null */
export function innerRange(el) {
  const loc = el.sourceCodeLocation;
  if (!loc?.startTag || !loc?.endTag) return null;
  return { start: loc.startTag.endOffset, end: loc.endTag.startOffset };
}

/** 요소 전체(outerHTML) 범위 */
export function outerRange(el) {
  const loc = el.sourceCodeLocation;
  if (!loc) return null;
  return { start: loc.startOffset, end: loc.endOffset };
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** 일반 텍스트 → HTML (줄바꿈은 <br>) */
export function textToHtml(s) {
  return escapeHtml(s).replace(/\r?\n/g, '<br>');
}

/** HTML 조각 → 일반 텍스트 (<br>은 줄바꿈, 공백은 HTML 규칙대로 축약) */
export function htmlToText(html) {
  const frag = parseFragment(html);
  let out = '';
  walk(frag, n => {
    if (n.nodeName === '#text') out += n.value.replace(/[ \t\r\n\f]+/g, ' ');
    else if (n.tagName === 'br') out += '\n';
  });
  return out.split('\n').map(l => l.replace(/^ +| +$/g, '')).join('\n').trim();
}

/** 내부에 <br> 외의 태그가 있는지 */
export function hasMarkup(html) {
  const frag = parseFragment(html);
  let found = false;
  walk(frag, n => {
    if (isEl(n) && n.tagName !== 'br') found = true;
  });
  return found;
}

/**
 * 속성 값 교체(없으면 추가)하는 replacement 생성.
 * @returns {{start:number,end:number,text:string}}
 */
export function attrReplacement(html, el, name, value) {
  const loc = el.sourceCodeLocation;
  const a = loc.attrs?.[name];
  const text = `${name}="${escapeAttr(value)}"`;
  if (a) return { start: a.startOffset, end: a.endOffset, text };
  // 여는 태그 끝('>' 또는 '/>') 직전에 삽입
  let pos = loc.startTag.endOffset - 1;
  if (html[pos - 1] === '/') pos -= 1;
  return { start: pos, end: pos, text: ' ' + text };
}

/** replacement 목록을 뒤에서부터 적용 (구간이 겹치면 앞선 항목 우선, 겹친 항목은 버림) */
export function applyReplacements(html, reps) {
  const sorted = [...reps].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  let floor = Infinity;
  for (const r of sorted) {
    if (r.end > floor) continue;
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
    floor = r.start;
  }
  return out;
}
