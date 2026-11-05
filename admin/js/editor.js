// 간단한 글 편집기 (굵게, 소제목, 목록, 링크, 사진, 유튜브).
// 기존 글의 HTML(표, 사진 묶음 등)은 그대로 보존하면서 글자만 고칠 수 있다.
import { esc, promptBox, toast, friendlyError } from './ui.js';
import { uploadImage, pickFiles } from './upload.js';

const PURIFY = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allow', 'allowfullscreen', 'loading', 'target', 'frameborder'],
  FORBID_TAGS: ['script', 'style', 'form', 'input', 'button', 'object', 'embed'],
};

export function cleanHtml(html) {
  const clean = window.DOMPurify.sanitize(html, PURIFY);
  // 유튜브 외 iframe 제거
  const tmp = document.createElement('div');
  tmp.innerHTML = clean;
  tmp.querySelectorAll('iframe').forEach(f => {
    if (!/^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//.test(f.getAttribute('src') || '')) f.remove();
  });
  tmp.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  return tmp.innerHTML;
}

const TOOLS = [
  { cmd: 'h2', label: '소제목', title: '소제목' },
  { cmd: 'p', label: '본문', title: '일반 문단' },
  { cmd: 'bold', label: '<b>굵게</b>', title: '굵게' },
  { cmd: 'insertUnorderedList', label: '• 목록', title: '글머리 목록' },
  { cmd: 'link', label: '🔗 링크', title: '링크 넣기' },
  { cmd: 'image', label: '🖼 사진', title: '사진 넣기' },
  { cmd: 'youtube', label: '▶ 유튜브', title: '유튜브 영상 넣기' },
  { cmd: 'removeFormat', label: '서식 지우기', title: '굵게·링크 등 서식 지우기' },
  { cmd: 'undo', label: '↶', title: '실행 취소' },
  { cmd: 'redo', label: '↷', title: '다시 실행' },
];

/**
 * @param {HTMLElement} mount
 * @param {string} html 초기 내용
 * @param {{folder?:string, onChange?:Function, simple?:boolean}} opts
 */
export function createEditor(mount, html, opts = {}) {
  const tools = opts.simple ? TOOLS.filter(t => !['image', 'youtube'].includes(t.cmd)) : TOOLS;
  mount.classList.add('editor');
  mount.innerHTML = `
    <div class="editor-toolbar" role="toolbar">
      ${tools.map(t => `<button type="button" data-cmd="${t.cmd}" title="${esc(t.title)}">${t.label}</button>`).join('')}
    </div>
    <div class="editor-area article-like" contenteditable="true" spellcheck="false"></div>`;
  const area = mount.querySelector('.editor-area');
  area.innerHTML = cleanHtml(html || '');
  protectEmbeds(area);
  let savedRange = null;

  const changed = () => opts.onChange?.();
  area.addEventListener('input', changed);
  area.addEventListener('blur', () => {
    const sel = getSelection();
    if (sel.rangeCount && area.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  });
  area.addEventListener('focus', () => document.execCommand('defaultParagraphSeparator', false, 'p'));

  // 붙여넣기: 서식 없는 글자로 (블로그·워드 서식이 섞이지 않도록)
  area.addEventListener('paste', e => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const html = text.split(/\r?\n\s*\r?\n/).map(p => `<p>${esc(p).replace(/\r?\n/g, '<br>')}</p>`).join('');
    document.execCommand('insertHTML', false, html);
  });

  const restore = () => {
    area.focus();
    if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  };

  mount.querySelector('.editor-toolbar').addEventListener('mousedown', e => {
    if (e.target.closest('button')) e.preventDefault(); // 선택 영역 유지
  });
  mount.querySelector('.editor-toolbar').addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    const sel = getSelection();
    if (sel.rangeCount && area.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
    if (cmd === 'h2' || cmd === 'p') { restore(); document.execCommand('formatBlock', false, cmd); }
    else if (cmd === 'link') {
      const url = await promptBox('링크 넣기', '연결할 주소 (https://...)', 'https://');
      if (!url || url === 'https://') return;
      if (!/^(https?:\/\/|mailto:|tel:|\/)/.test(url)) return toast('https:// 로 시작하는 주소를 입력해 주세요.', 'error');
      restore();
      document.execCommand('createLink', false, url);
      area.querySelectorAll(`a[href="${CSS.escape(url)}"]`).forEach(a => {
        if (/^https?:/.test(url)) { a.target = '_blank'; a.rel = 'noopener'; }
      });
    } else if (cmd === 'image') {
      const [file] = await pickFiles();
      if (!file) return;
      try {
        toast('사진을 올리는 중입니다…', 'info');
        const { url } = await uploadImage(file, opts.folder || 'posts');
        restore();
        document.execCommand('insertHTML', false, `<p><img src="${esc(url)}" alt="" style="border-radius:12px;margin:8px 0;"></p>`);
      } catch (err) { toast(friendlyError(err), 'error', 6000); }
    } else if (cmd === 'youtube') {
      const url = await promptBox('유튜브 영상 넣기', '유튜브 영상 주소', '', 'https://youtu.be/...');
      if (!url) return;
      const id = (url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/) || [])[1];
      if (!id) return toast('유튜브 영상 주소를 확인해 주세요.', 'error');
      restore();
      document.execCommand('insertHTML', false,
        `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${id}" title="유튜브 영상" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div><p><br></p>`);
      protectEmbeds(area);
    } else {
      restore();
      document.execCommand(cmd, false, null);
    }
    changed();
  });

  return {
    getHtml: () => cleanHtml(area.innerHTML).replace(/<p><br><\/p>\s*$/, '').trim(),
    setHtml: h => { area.innerHTML = cleanHtml(h || ''); protectEmbeds(area); },
    focus: () => area.focus(),
  };
}

// 영상 상자는 통째로만 지울 수 있게 (안쪽 글자 편집 방지)
function protectEmbeds(area) {
  area.querySelectorAll('.video-embed, iframe, table').forEach(el => {
    if (el.matches('.video-embed, iframe')) el.setAttribute('contenteditable', 'false');
  });
}
