// 현재 HTML 파일에서 CMS 콘텐츠를 추출한다 (초기 이전 및 검증용).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseDoc, findAll, findFirst, hasClass, getAttr, innerRange, htmlToText } from '../../api/_lib/html.js';
import { extractBlocks, findSlots } from '../../api/_lib/slots.js';
import { extractPost, metaText, seoTitle } from '../../api/_lib/post.js';

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const CMS_PAGES = ['index', 'news', 'gallery', 'greeting', 'instructor', 'philosophy'];

export const read = rel => readFileSync(join(ROOT, rel), 'utf8');

function text(html, el) {
  const r = el && innerRange(el);
  return r ? htmlToText(html.slice(r.start, r.end)) : '';
}

function dotToIso(s) {
  const m = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (!m) throw new Error(`날짜 형식 오류: ${s}`);
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

export function extractAllBlocks() {
  return CMS_PAGES.flatMap(p => extractBlocks(read(`${p}.html`), p));
}

export function extractPosts() {
  const html = read('news.html');
  const doc = parseDoc(html);
  const cards = findAll(doc, n => n.tagName === 'a' && hasClass(n, 'news-card'));
  return cards.map((card, i) => {
    const href = getAttr(card, 'href');
    const slug = href.match(/^post-([a-z0-9-]+)\.html$/)[1];
    const img = findFirst(card, n => n.tagName === 'img');
    const c = {
      src: getAttr(img, 'src'),
      alt: getAttr(img, 'alt'),
      date: text(html, findFirst(card, n => hasClass(n, 'news-card-date'))),
      badge: text(html, findFirst(card, n => hasClass(n, 'news-card-badge'))),
      title: text(html, findFirst(card, n => hasClass(n, 'news-card-title'))),
      excerpt: text(html, findFirst(card, n => hasClass(n, 'news-card-excerpt'))),
    };
    const file = `post-${slug}.html`;
    if (!existsSync(join(ROOT, file))) throw new Error(`글 파일 없음: ${file}`);
    const p = extractPost(read(file));
    const post = {
      slug,
      title: p.title,
      category: p.category,
      published_on: dotToIso(c.date),
      excerpt: c.excerpt,
      cover_url: p.cover_url,
      cover_alt: p.cover_alt,
      body_html: p.body_html,
      after_html: p.after_html,
      list_title: c.title !== p.title ? c.title : null,
      list_category: c.badge !== p.category ? c.badge : null,
      card_image_url: null,
      card_image_alt: null,
      meta_text: null,
      seo_title: null,
      is_published: true,
      sort: i,
    };
    if (c.src !== p.cover_url || c.alt !== p.cover_alt) {
      post.card_image_url = c.src;
      post.card_image_alt = c.alt;
    }
    if (metaText(post) !== p.meta_text) post.meta_text = p.meta_text;
    if (seoTitle(post) !== p.seo_title) post.seo_title = p.seo_title;
    return post;
  });
}

export function extractGallery() {
  const html = read('gallery.html');
  const { lists } = findSlots(html);
  const items = [];
  for (const list of lists) {
    const pane = list.name.replace(/^gallery:/, '');
    const links = findAll(list.el, n => n.tagName === 'a' && hasClass(n, 'photo-item'));
    links.forEach((a, i) => {
      const img = findFirst(a, n => n.tagName === 'img');
      const src = getAttr(img, 'src');
      if (getAttr(a, 'href') !== src) console.warn(`⚠ 갤러리 링크/이미지 주소 다름: ${src}`);
      items.push({
        pane,
        src,
        title: getAttr(a, 'data-title') || '',
        caption: text(html, findFirst(a, n => hasClass(n, 'photo-caption'))),
        alt: getAttr(img, 'alt') || '',
        big: hasClass(a, 'big'),
        sort: i,
      });
    });
  }
  return items;
}

export function extractAll() {
  return { blocks: extractAllBlocks(), posts: extractPosts(), gallery: extractGallery() };
}
