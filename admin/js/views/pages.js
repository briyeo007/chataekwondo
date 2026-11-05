// 페이지 문구·사진: 각 페이지의 수정 가능한 항목(개발자가 HTML에 지정한 영역)을 편집
import { db } from '../api.js';
import { $, $$, esc, toast, busy, fmtDateTime, friendlyError, isConflict, confirmBox } from '../ui.js';
import { createEditor } from '../editor.js';
import { uploadImage, pickFiles, checkFile } from '../upload.js';
import { go, setDirty } from '../app.js';

export const PAGE_INFO = {
  index: { label: '메인 화면', url: '/', desc: '첫 화면 문구, 특징 소개, 숫자, 프로그램 소개(사진 포함)' },
  greeting: { label: '관장님 인사말', url: '/greeting.html', desc: '인사말 본문, 관장님 사진, 약력' },
  instructor: { label: '지도자 소개', url: '/instructor.html', desc: '프로필, 소개글, 경력, 해외 활동, 수상 경력' },
  philosophy: { label: '교육 철학', url: '/philosophy.html', desc: '교육 철학 본문' },
  news: { label: '도장 소식 페이지', url: '/news.html', desc: '소식 목록 위 소개 문구' },
  gallery: { label: '갤러리 페이지', url: '/gallery.html', desc: '갤러리 페이지 문구' },
};

export async function renderPages(main) {
  const meta = await db.allBlocksMeta();
  const pages = [...new Set(meta.map(b => b.page))].sort((a, b) => Object.keys(PAGE_INFO).indexOf(a) - Object.keys(PAGE_INFO).indexOf(b));
  main.innerHTML = `
    <h1 class="page-title">페이지 문구·사진</h1>
    <p class="muted">수정할 페이지를 선택하세요. 디자인은 그대로 두고 글과 사진만 바뀝니다.</p>
    <div class="page-list">
      ${pages.map(p => {
        const info = PAGE_INFO[p] || { label: p, desc: '' };
        const rows = meta.filter(b => b.page === p);
        const last = rows.map(b => b.updated_at).sort().pop();
        return `<button class="card page-card" data-page="${esc(p)}">
          <b>${esc(info.label)}</b><small>${esc(info.desc)}</small>
          <small class="muted">수정 가능 항목 ${rows.length}개 · 마지막 수정 ${fmtDateTime(last)}</small></button>`;
      }).join('')}
    </div>`;
  main.addEventListener('click', e => {
    const b = e.target.closest('[data-page]');
    if (b) go('page', { p: b.dataset.page });
  });
}

export async function renderPageEdit(main, params) {
  const page = params.p;
  const info = PAGE_INFO[page] || { label: page, url: '/' };
  let blocks = await db.listBlocks(page);
  const editors = new Map();
  const pending = new Map(); // key → { value, meta }

  main.innerHTML = `
    <div class="page-head">
      <div><a href="#" class="back" data-back>← 페이지 목록</a><h1 class="page-title">${esc(info.label)}</h1></div>
      <a class="btn btn-ghost" href="${esc(info.url)}" target="_blank" rel="noopener">홈페이지에서 보기 ↗</a>
    </div>
    <p class="muted small">각 칸에는 지금 홈페이지에 보이는 내용이 들어 있습니다. 수정한 칸은 노란색으로 표시되며, 아래 [저장]을 눌러야 반영됩니다.</p>
    <form class="stack blocks-form" novalidate>
      ${blocks.map(b => fieldHtml(b)).join('')}
      <div class="save-bar">
        <button type="button" class="btn" data-cancel>취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`;

  const form = $('form', main);
  const markDirty = key => {
    const b = blocks.find(x => x.key === key);
    const cur = currentValue(b);
    const changed = cur.value !== b.value || JSON.stringify(cur.meta) !== JSON.stringify(b.meta || {});
    if (changed) pending.set(key, cur); else pending.delete(key);
    $(`[data-block="${CSS.escape(key)}"]`, main)?.classList.toggle('changed', changed);
    setDirty(pending.size > 0);
  };

  const imgState = new Map(blocks.filter(b => b.type === 'image').map(b => [b.key, b.value]));
  function currentValue(b) {
    const box = $(`[data-block="${CSS.escape(b.key)}"]`, main);
    if (b.type === 'html') return { value: editors.get(b.key).getHtml(), meta: b.meta || {} };
    if (b.type === 'image') return { value: imgState.get(b.key), meta: { ...(b.meta || {}), alt: $('[name=alt]', box).value.trim() } };
    return { value: $('[name=value]', box).value.replace(/\r\n/g, '\n').trim(), meta: b.meta || {} };
  }

  for (const b of blocks.filter(x => x.type === 'html')) {
    const box = $(`[data-block="${CSS.escape(b.key)}"] .html-editor`, main);
    const ed = createEditor(box, b.value, { folder: 'pages', onChange: () => markDirty(b.key) });
    editors.set(b.key, ed);
    // 정화 과정의 사소한 차이를 "변경"으로 보지 않도록 기준값을 편집기 출력으로 맞춤
    b.value = ed.getHtml();
  }

  form.addEventListener('input', e => {
    const box = e.target.closest('[data-block]');
    if (box) markDirty(box.dataset.block);
  });

  main.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-back]')) { e.preventDefault(); return go('pages'); }
    if (t.closest('[data-cancel]')) {
      if (pending.size && !(await confirmBox('수정 취소', '수정한 내용을 모두 되돌릴까요?', '되돌리기', true))) return;
      setDirty(false);
      return go('page', { p: page }, { replace: true });
    }
    const revert = t.closest('[data-revert]');
    if (revert) {
      const key = revert.dataset.revert;
      const b = blocks.find(x => x.key === key);
      const box = $(`[data-block="${CSS.escape(key)}"]`, main);
      if (b.type === 'html') editors.get(key).setHtml(b.value);
      else if (b.type === 'image') { imgState.set(key, b.value); $('img', box).src = b.value; $('[name=alt]', box).value = b.meta?.alt || ''; }
      else $('[name=value]', box).value = b.value;
      return markDirty(key);
    }
    const pick = t.closest('[data-pick-image]');
    if (pick) {
      const key = pick.dataset.pickImage;
      const [file] = await pickFiles();
      if (!file) return;
      const problem = checkFile(file);
      if (problem) return toast(problem, 'error', 6000);
      try {
        const { url } = await busy(pick, () => uploadImage(file, 'pages'), '올리는 중…');
        imgState.set(key, url);
        $(`[data-block="${CSS.escape(key)}"] img`, main).src = url;
        markDirty(key);
      } catch (err) { toast(friendlyError(err), 'error', 6000); }
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!pending.size) return toast('바뀐 내용이 없습니다.', 'info');
    await busy($('button[type=submit]', form), async () => {
      const conflicts = [];
      let saved = 0;
      for (const [key, cur] of [...pending]) {
        const b = blocks.find(x => x.key === key);
        try {
          const row = await db.updateBlock(key, b.version, { value: cur.value, meta: cur.meta });
          Object.assign(b, row, b.type === 'html' ? { value: editors.get(key).getHtml() } : {});
          pending.delete(key);
          $(`[data-block="${CSS.escape(key)}"]`, main).classList.remove('changed');
          saved++;
        } catch (err) {
          if (isConflict(err)) conflicts.push(b.label);
          else { toast(friendlyError(err), 'error', 7000); break; }
        }
      }
      setDirty(pending.size > 0);
      if (saved) toast(`${saved}개 항목을 저장했습니다. 1분 안에 홈페이지에 반영됩니다.`);
      if (conflicts.length) {
        await confirmBox('다른 곳에서 먼저 수정됨', `다음 항목은 다른 곳에서 먼저 수정되어 저장하지 않았습니다:\n\n• ${conflicts.join('\n• ')}\n\n화면을 새로 불러온 뒤 다시 수정해 주세요.`, '확인');
      }
    }, '저장 중…');
  });
}

function fieldHtml(b) {
  const head = `<div class="block-head"><b>${esc(b.label)}</b><button type="button" class="link-sm revert" data-revert="${esc(b.key)}">↺ 원래대로</button></div>`;
  let input;
  switch (b.type) {
    case 'image':
      input = `<div class="image-field">
        <img src="${esc(b.value)}" alt="">
        <div class="stack">
          <button type="button" class="btn" data-pick-image="${esc(b.key)}">사진 바꾸기</button>
          <label class="field"><span>사진 설명</span><input name="alt" value="${esc(b.meta?.alt || '')}" maxlength="300"></label>
        </div></div>`;
      break;
    case 'html':
      input = '<div class="html-editor"></div>';
      break;
    case 'number':
      input = `<input name="value" inputmode="numeric" value="${esc(b.value)}" maxlength="10">`;
      break;
    case 'lines': {
      const pipe = b.value.includes('|');
      input = `<p class="hint">한 줄에 하나씩 적어 주세요.${pipe ? ' 형식: <code>아이콘 | 내용</code>' : ''} 줄을 추가하거나 지우면 항목 수가 바뀝니다.</p>
        <textarea name="value" rows="${Math.min(14, b.value.split('\n').length + 1)}">${esc(b.value)}</textarea>`;
      break;
    }
    default: {
      const lines = b.value.split('\n').length;
      input = b.value.length > 60 || lines > 1
        ? `<textarea name="value" rows="${Math.min(10, Math.max(2, lines + Math.ceil(b.value.length / 70)))}">${esc(b.value)}</textarea>${lines > 1 ? '<p class="hint">줄바꿈은 홈페이지에서도 줄바꿈으로 보입니다.</p>' : ''}`
        : `<input name="value" value="${esc(b.value)}">`;
    }
  }
  return `<section class="card block" data-block="${esc(b.key)}">${head}${input}
    <small class="muted">마지막 수정 ${fmtDateTime(b.updated_at)}</small></section>`;
}
