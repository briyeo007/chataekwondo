// 페이지 HTML 안의 "관리자 수정 가능 영역(슬롯)"을 찾고, 값 추출/적용을 담당한다.
//
// 슬롯 표기법 (개발자가 HTML에 직접 붙임):
//   <h1 data-cms="index.hero.title" data-cms-label="메인 큰 제목">...</h1>   → 텍스트/HTML
//   <img data-cms="greeting.photo" data-cms-label="관장님 사진" src=...>     → 이미지
//   <ul data-cms="instructor.career1" data-cms-type="lines">...</ul>          → 줄 목록
//   <!--cms:greeting.message|인사말 본문--> ... <!--/cms:greeting.message-->  → 여러 요소 묶음(HTML)
//   <div data-cms-list="news">...</div>                                        → DB 목록(소식/갤러리)
import {
  parseDoc, parseFrag, walk, getAttr, isEl, innerRange, attrReplacement,
  applyReplacements, htmlToText, hasMarkup, textToHtml, escapeHtml,
} from './html.js';

const COMMENT_START = /^cms:([\w.-]+)(?:\|(.*))?$/;
const COMMENT_END = /^\/cms:([\w.-]+)$/;

export function findSlots(html, doc = parseDoc(html)) {
  const slots = [];
  const lists = [];
  const openRegions = new Map();

  walk(doc, n => {
    if (n.nodeName === '#comment') {
      const data = n.data.trim();
      let m;
      if ((m = data.match(COMMENT_START))) {
        openRegions.set(m[1], { key: m[1], label: (m[2] || '').trim(), startNode: n });
      } else if ((m = data.match(COMMENT_END)) && openRegions.has(m[1])) {
        const r = openRegions.get(m[1]);
        openRegions.delete(m[1]);
        slots.push({
          key: r.key, label: r.label || r.key, type: 'html',
          range: { start: r.startNode.sourceCodeLocation.endOffset, end: n.sourceCodeLocation.startOffset },
        });
      }
      return;
    }
    if (!isEl(n)) return;

    const listName = getAttr(n, 'data-cms-list');
    if (listName) {
      const range = innerRange(n);
      if (range) lists.push({ name: listName, range, el: n });
      return false; // 목록 내부는 더 탐색하지 않음
    }

    const key = getAttr(n, 'data-cms');
    if (!key) return;
    const label = getAttr(n, 'data-cms-label') || key;

    if (n.tagName === 'img') {
      slots.push({ key, label, type: 'image', el: n });
      return false;
    }
    const range = innerRange(n);
    if (!range) return;
    const hint = getAttr(n, 'data-cms-type');
    const inner = html.slice(range.start, range.end);
    let type = hint || (getAttr(n, 'data-target') !== undefined ? 'number' : hasMarkup(inner) ? 'html' : 'text');
    slots.push({ key, label, type, el: n, range });
    return false;
  });

  return { slots, lists };
}

/* ── lines(줄 목록) 타입 ─────────────────────────────────────────── */

function elementChildren(el) {
  return (el.childNodes || []).filter(isEl);
}

/** 템플릿 요소 안의 "글자만 담은 말단 요소"들 */
function leafElements(el) {
  const leaves = [];
  walk(el, n => {
    if (!isEl(n)) return;
    const kids = elementChildren(n).filter(k => k.tagName !== 'br');
    if (kids.length === 0) { leaves.push(n); return false; }
  });
  return leaves;
}

function linesExtract(html, slot) {
  return elementChildren(slot.el).map(child => {
    return leafElements(child)
      .map(leaf => { const r = innerRange(leaf); return r ? htmlToText(html.slice(r.start, r.end)) : ''; })
      .join(' | ');
  }).join('\n');
}

function linesRender(html, slot, value) {
  const kids = elementChildren(slot.el);
  if (!kids.length) return null;
  const first = kids[0];
  const last = kids[kids.length - 1];
  const lead = html.slice(slot.range.start, first.sourceCodeLocation.startOffset);
  const trail = html.slice(last.sourceCodeLocation.endOffset, slot.range.end);
  const sep = kids.length > 1
    ? html.slice(first.sourceCodeLocation.endOffset, kids[1].sourceCodeLocation.startOffset) : lead;

  // i번째 줄은 기존 i번째 항목의 모양을 따르고, 늘어난 줄은 마지막 항목 모양을 따른다
  // (예: 첫 번째 자격 태그만 강조색)
  const templates = kids.map(k => {
    const tpl = html.slice(k.sourceCodeLocation.startOffset, k.sourceCodeLocation.endOffset);
    const tplEl = elementChildren(parseFrag(tpl))[0];
    return { tpl, leaves: leafElements(tplEl) };
  });

  const items = String(value || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rendered = items.map((line, idx) => {
    const { tpl, leaves } = templates[Math.min(idx, templates.length - 1)];
    const parts = leaves.length > 1 ? line.split('|').map(s => s.trim()) : [line];
    const reps = leaves.map((leaf, i) => {
      const r = innerRange(leaf);
      return r && { start: r.start, end: r.end, text: escapeHtml(parts[i] ?? '') };
    }).filter(Boolean);
    return applyReplacements(tpl, reps);
  });
  return lead + rendered.join(sep) + trail;
}

/* ── 값 추출 (초기 이전용) ───────────────────────────────────────── */

export function extractValue(html, slot) {
  switch (slot.type) {
    case 'image':
      return { value: getAttr(slot.el, 'src') || '', meta: { alt: getAttr(slot.el, 'alt') || '' } };
    case 'text':
    case 'number':
      return { value: htmlToText(html.slice(slot.range.start, slot.range.end)), meta: {} };
    case 'lines':
      return { value: linesExtract(html, slot), meta: {} };
    default:
      return { value: html.slice(slot.range.start, slot.range.end).trim(), meta: {} };
  }
}

/* ── 값 적용 (렌더링) ────────────────────────────────────────────── */

/**
 * @param {string} html 원본 템플릿
 * @param {Map<string, {type,value,meta}>} blocks DB 콘텐츠
 * @param {Record<string,string>} listsHtml 목록 이름 → 생성된 HTML
 * @param {(html:string)=>string} sanitize HTML 정화 함수
 */
export function applySlots(html, blocks, listsHtml, sanitize) {
  const { slots, lists } = findSlots(html);
  const reps = [];

  for (const slot of slots) {
    const b = blocks.get(slot.key);
    if (!b) continue; // DB에 없으면 원본 유지
    if (slot.type === 'image') {
      if (b.value) reps.push(attrReplacement(html, slot.el, 'src', b.value));
      if (b.meta && typeof b.meta.alt === 'string') reps.push(attrReplacement(html, slot.el, 'alt', b.meta.alt));
      continue;
    }
    let text;
    if (slot.type === 'text') text = textToHtml(b.value);
    else if (slot.type === 'number') {
      text = escapeHtml(b.value);
      const n = parseFloat(String(b.value).replace(/[^\d.]/g, ''));
      if (!Number.isNaN(n)) reps.push(attrReplacement(html, slot.el, 'data-target', String(n)));
    } else if (slot.type === 'lines') text = linesRender(html, slot, b.value);
    else text = sanitize(b.value);
    if (text == null) continue;
    // 기존 들여쓰기/줄바꿈을 보존하기 위해 앞뒤 공백 유지 (html 영역)
    if (slot.type === 'html') {
      const orig = html.slice(slot.range.start, slot.range.end);
      const lead = orig.match(/^\s*/)[0];
      const trail = orig.match(/\s*$/)[0];
      text = lead + text + trail;
    }
    reps.push({ ...slot.range, text });
  }

  for (const list of lists) {
    const generated = listsHtml?.[list.name];
    if (generated == null) continue;
    reps.push({ ...list.range, text: generated });
  }

  return applyReplacements(html, reps);
}

/** 초기 이전용: 페이지의 모든 슬롯을 DB 행 형태로 추출 */
export function extractBlocks(html, pageName) {
  const { slots } = findSlots(html);
  return slots.map((slot, i) => {
    const { value, meta } = extractValue(html, slot);
    return { key: slot.key, page: pageName, label: slot.label, type: slot.type, value, meta, sort: i };
  });
}
