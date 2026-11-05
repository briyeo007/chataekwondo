// 도장 소식: 목록 · 작성 · 수정 · 삭제(휴지통) · 복구
import { db } from '../api.js';
import { $, $$, esc, toast, confirmBox, busy, fmtDate, fmtDateTime, todayKST, friendlyError, isConflict } from '../ui.js';
import { createEditor, cleanHtml } from '../editor.js';
import { uploadImage, pickFiles, checkFile } from '../upload.js';
import { go, setDirty } from '../app.js';

/* ── 목록 ─────────────────────────────────────────────── */
export async function renderPosts(main, params) {
  const trash = params.tab === 'trash';
  const all = await db.listPosts();
  const rows = all.filter(p => (trash ? p.deleted_at : !p.deleted_at));
  const trashCount = all.filter(p => p.deleted_at).length;

  main.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">도장 소식</h1>
      <button class="btn btn-primary" data-new>✍️ 새 소식 쓰기</button>
    </div>
    <div class="tabs">
      <a href="#" class="${trash ? '' : 'active'}" data-tab="">게시된 글 (${all.length - trashCount})</a>
      <a href="#" class="${trash ? 'active' : ''}" data-tab="trash">휴지통 (${trashCount})</a>
    </div>
    ${trash ? '<p class="muted small">휴지통의 글은 홈페이지에 보이지 않습니다. 복구하거나 영구 삭제할 수 있습니다.</p>' : ''}
    <input type="search" class="search" placeholder="제목으로 찾기">
    <div class="post-list">
      ${rows.map(p => `
        <div class="card post-row" data-id="${p.id}" data-title="${esc(p.title.toLowerCase())}">
          <img src="${esc(p.cover_url || '/logo-01.png')}" alt="" loading="lazy">
          <div class="post-info">
            <b>${esc(p.title)}</b>
            <small>${fmtDate(p.published_on)} · ${esc(p.category)}${p.is_published ? '' : ' · <span class="badge badge-gray">비공개</span>'}</small>
            <small class="muted">작성 ${fmtDateTime(p.created_at)} · 수정 ${fmtDateTime(p.updated_at)}</small>
          </div>
          <div class="row-actions">
            ${trash
              ? `<button class="btn btn-sm" data-restore>복구</button><button class="btn btn-sm btn-danger" data-purge>영구 삭제</button>`
              : `<a class="btn btn-sm btn-ghost" href="/post-${esc(p.slug)}.html" target="_blank" rel="noopener">보기</a><button class="btn btn-sm" data-edit>수정</button><button class="btn btn-sm btn-danger-ghost" data-del>삭제</button>`}
          </div>
        </div>`).join('') || `<div class="card empty">${trash ? '휴지통이 비어 있습니다.' : '아직 글이 없습니다.'}</div>`}
    </div>`;

  $('.search', main).addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $$('.post-row', main).forEach(r => { r.hidden = q && !r.dataset.title.includes(q); });
  });

  main.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-new]')) return go('post', { id: 'new' });
    const tab = t.closest('[data-tab]');
    if (tab) { e.preventDefault(); return go('posts', tab.dataset.tab ? { tab: tab.dataset.tab } : {}); }
    const row = t.closest('.post-row');
    if (!row) return;
    const p = all.find(x => x.id === row.dataset.id);
    if (t.closest('[data-edit]')) return go('post', { id: p.id });
    try {
      if (t.closest('[data-del]')) {
        if (!(await confirmBox('글 삭제', `"${p.title}"\n\n이 글을 휴지통으로 옮길까요? 홈페이지에서 바로 사라지며, 휴지통에서 복구할 수 있습니다.`, '삭제', true))) return;
        await db.updatePost(p.id, p.version, { deleted_at: new Date().toISOString() });
        toast('휴지통으로 옮겼습니다.');
        return go('posts', {}, { replace: true });
      }
      if (t.closest('[data-restore]')) {
        await db.updatePost(p.id, p.version, { deleted_at: null });
        toast('복구했습니다. 홈페이지에 다시 표시됩니다.');
        return go('posts', { tab: 'trash' }, { replace: true });
      }
      if (t.closest('[data-purge]')) {
        if (!(await confirmBox('영구 삭제', `"${p.title}"\n\n영구 삭제하면 휴지통에서도 사라집니다. (변경 기록에는 남아 개발자가 복구할 수 있습니다)`, '영구 삭제', true))) return;
        await db.deletePostForever(p.id);
        toast('영구 삭제했습니다.');
        return go('posts', { tab: 'trash' }, { replace: true });
      }
    } catch (err) { toast(friendlyError(err), 'error', 6000); }
  });
}

/* ── 본문 아래 영역(after_html) 다루기: 블로그 링크 · 현장 사진 ─────── */
// 기존 글마다 사진 묶음 모양이 달라서, 기존 마크업은 그대로 두고 사진만 추가/삭제한다.
function parseAfter(html) {
  const root = document.createElement('div');
  root.innerHTML = cleanHtml(html || '');
  return root;
}
function afterBlogUrl(root) {
  return root.querySelector('a.blog-banner-link')?.getAttribute('href') || '';
}
function afterImages(root) {
  return $$('img', root).map(img => ({ src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' }));
}
function buildAfter(origHtml, { blogUrl, images, title }) {
  const root = parseAfter(origHtml);
  // 블로그 링크
  const banner = root.querySelector('.blog-banner');
  if (!blogUrl) banner?.remove();
  else if (banner) banner.querySelector('a.blog-banner-link')?.setAttribute('href', blogUrl);
  else {
    root.insertAdjacentHTML('afterbegin', `<div class="blog-banner">
      <span class="blog-banner-text">📝 블로그에서 더 많은 이야기를 확인하세요</span>
      <a href="${esc(blogUrl)}" target="_blank" rel="noopener" class="blog-banner-link">블로그 보기 →</a>
    </div>`);
  }
  // 사진: 남길 사진 / 새 사진
  const keep = new Set(images.filter(i => !i.isNew).map(i => i.src));
  const existing = $$('img', root);
  const lastImg = existing[existing.length - 1];
  const topOf = el => { while (el.parentElement && el.parentElement !== root) el = el.parentElement; return el; };
  const touched = new Set();
  existing.forEach(img => { if (!keep.has(img.getAttribute('src'))) { touched.add(topOf(img)); img.remove(); } });
  touched.forEach(top => { if (top !== root && !top.querySelector('img')) top.remove(); });
  const fresh = images.filter(i => i.isNew);
  if (fresh.length) {
    const anchor = $$('img', root).pop() || (lastImg?.isConnected ? lastImg : null);
    if (anchor) {
      fresh.forEach(i => {
        const clone = anchor.cloneNode(false);
        clone.setAttribute('src', i.src);
        clone.setAttribute('alt', i.alt || title);
        anchor.parentElement.appendChild(clone);
      });
    } else {
      root.insertAdjacentHTML('beforeend', `<div class="gallery-section">
      <h2>📷 현장 스케치</h2>
      <div class="gallery-grid" id="galleryGrid">
        ${fresh.map(i => `<img src="${esc(i.src)}" alt="${esc(i.alt || title)}" loading="lazy">`).join('\n        ')}
      </div>
    </div>`);
    }
  }
  return root.innerHTML.trim();
}

/* ── 작성 / 수정 ────────────────────────────────────────── */
function newSlug() {
  const d = todayKST().replace(/-/g, '');
  const r = Math.random().toString(36).slice(2, 6);
  return `${d}-${r}`;
}

export async function renderPostEdit(main, params) {
  const isNew = params.id === 'new';
  let post = isNew
    ? { title: '', category: '도장소식', published_on: todayKST(), excerpt: '', cover_url: '', cover_alt: '', body_html: '', after_html: '', is_published: true }
    : await db.getPost(params.id);
  const original = JSON.stringify(post);
  let gallery = afterImages(parseAfter(post.after_html));

  main.innerHTML = `
    <div class="page-head">
      <div><a href="#" class="back" data-back>← 소식 목록</a><h1 class="page-title">${isNew ? '새 소식 쓰기' : '소식 수정'}</h1></div>
      ${isNew ? '' : `<a class="btn btn-ghost" href="/post-${esc(post.slug)}.html" target="_blank" rel="noopener">홈페이지에서 보기 ↗</a>`}
    </div>
    ${isNew ? '' : `<p class="muted small">작성 ${fmtDateTime(post.created_at)} · 마지막 수정 ${fmtDateTime(post.updated_at)}</p>`}
    <form class="post-form stack" novalidate>
      <section class="card stack">
        <label class="field"><span>제목 <em>*</em></span><input name="title" required maxlength="300" value="${esc(post.title)}"></label>
        <div class="grid-2">
          <label class="field"><span>분류 <small>(예: 도장소식, 승급 심사, 대회 소식)</small></span><input name="category" maxlength="60" value="${esc(post.category)}"></label>
          <label class="field"><span>날짜</span><input type="date" name="published_on" value="${esc(post.published_on)}"></label>
        </div>
        <label class="field"><span>요약 <small>(소식 목록에 보이는 2~3줄 설명)</small></span><textarea name="excerpt" rows="3" maxlength="1000">${esc(post.excerpt)}</textarea></label>
      </section>

      <section class="card stack">
        <h2>대표 사진</h2>
        <div class="image-field">
          <img class="cover-preview" src="${esc(post.cover_url)}" alt="" ${post.cover_url ? '' : 'hidden'}>
          <div class="stack">
            <div class="btn-row">
              <button type="button" class="btn" data-cover>${post.cover_url ? '사진 바꾸기' : '사진 올리기'}</button>
              <button type="button" class="btn btn-ghost" data-cover-remove ${post.cover_url ? '' : 'hidden'}>사진 빼기</button>
            </div>
            <label class="field"><span>사진 설명 <small>(시각장애인용 설명·검색에 사용)</small></span><input name="cover_alt" maxlength="300" value="${esc(post.cover_alt)}"></label>
          </div>
        </div>
      </section>

      <section class="card stack">
        <h2>본문</h2>
        <div class="body-editor"></div>
      </section>

      <section class="card stack">
        <h2>본문 아래 영역</h2>
        <label class="field"><span>네이버 블로그 링크 <small>(비워 두면 표시 안 함)</small></span>
          <input name="blog_url" type="url" placeholder="https://blog.naver.com/..." value="${esc(afterBlogUrl(parseAfter(post.after_html)))}"></label>
        <div class="field"><span>현장 사진</span>
          <div class="thumb-grid after-photos"></div>
          <button type="button" class="btn" data-add-photos>＋ 사진 추가 (여러 장 가능)</button>
        </div>
      </section>

      <details class="card advanced">
        <summary>추가 설정 (보통은 수정하지 않아도 됩니다)</summary>
        <div class="stack">
          <label class="field"><span>목록에 보일 제목 <small>(비우면 위 제목 사용)</small></span><input name="list_title" maxlength="300" value="${esc(post.list_title || '')}"></label>
          <label class="field"><span>목록에 보일 분류 <small>(비우면 위 분류 사용)</small></span><input name="list_category" maxlength="60" value="${esc(post.list_category || '')}"></label>
          <div class="field"><span>목록에 보일 사진 <small>(비우면 대표 사진 사용)</small></span>
            <div class="image-field">
              <img class="card-preview" src="${esc(post.card_image_url || '')}" alt="" ${post.card_image_url ? '' : 'hidden'}>
              <div class="btn-row"><button type="button" class="btn btn-sm" data-card>사진 선택</button><button type="button" class="btn btn-sm btn-ghost" data-card-remove>비우기</button></div>
            </div>
          </div>
          <label class="field"><span>날짜 표시 문구 <small>(비우면 "2026년 1월 1일 · 차 태권도" 형식)</small></span><input name="meta_text" maxlength="100" value="${esc(post.meta_text || '')}"></label>
          <label class="field"><span>브라우저 탭 제목 <small>(비우면 "제목 – 차 태권도")</small></span><input name="seo_title" maxlength="300" value="${esc(post.seo_title || '')}"></label>
        </div>
      </details>

      <section class="card">
        <label class="check"><input type="checkbox" name="is_published" ${post.is_published ? 'checked' : ''}> 홈페이지에 공개 <small class="muted">(체크를 풀면 저장해도 홈페이지에 보이지 않습니다)</small></label>
      </section>

      <div class="save-bar">
        <button type="button" class="btn" data-cancel>취소</button>
        <button type="submit" class="btn btn-primary">${isNew ? '글 올리기' : '저장'}</button>
      </div>
    </form>`;

  const form = $('form', main);
  const markDirty = () => setDirty(true);
  form.addEventListener('input', markDirty);
  const editor = createEditor($('.body-editor', main), post.body_html, { folder: 'posts', onChange: markDirty });

  let coverUrl = post.cover_url;
  let cardUrl = post.card_image_url || '';

  const drawPhotos = () => {
    $('.after-photos', main).innerHTML = gallery.map((g, i) => `
      <div class="thumb"><img src="${esc(g.src)}" alt=""><button type="button" class="thumb-del" data-del-photo="${i}" aria-label="사진 빼기">×</button></div>`).join('')
      || '<p class="muted small">사진이 없습니다.</p>';
  };
  drawPhotos();

  const uploadOne = async (btn, folder) => {
    const [file] = await pickFiles();
    if (!file) return null;
    const problem = checkFile(file);
    if (problem) { toast(problem, 'error', 6000); return null; }
    return busy(btn, () => uploadImage(file, folder).then(r => r.url), '올리는 중…');
  };

  main.addEventListener('click', async e => {
    const t = e.target;
    try {
      if (t.closest('[data-back]')) { e.preventDefault(); return go('posts'); }
      if (t.closest('[data-cancel]')) {
        if (JSON.stringify(collect()) === JSON.stringify(collect(true)) && !isDirtyEditor()) return go('posts');
        return go('posts'); // go()가 저장 안 한 내용 확인 창을 띄움
      }
      if (t.closest('[data-cover]')) {
        const url = await uploadOne(t.closest('button'), 'posts');
        if (!url) return;
        coverUrl = url;
        Object.assign($('.cover-preview', main), { src: url, hidden: false });
        $('[data-cover-remove]', main).hidden = false;
        markDirty();
      }
      if (t.closest('[data-cover-remove]')) {
        coverUrl = '';
        $('.cover-preview', main).hidden = true;
        t.closest('button').hidden = true;
        markDirty();
      }
      if (t.closest('[data-card]')) {
        const url = await uploadOne(t.closest('button'), 'posts');
        if (!url) return;
        cardUrl = url;
        Object.assign($('.card-preview', main), { src: url, hidden: false });
        markDirty();
      }
      if (t.closest('[data-card-remove]')) { cardUrl = ''; $('.card-preview', main).hidden = true; markDirty(); }
      const del = t.closest('[data-del-photo]');
      if (del) { gallery.splice(+del.dataset.delPhoto, 1); drawPhotos(); markDirty(); }
      if (t.closest('[data-add-photos]')) {
        const files = await pickFiles({ multiple: true });
        if (!files.length) return;
        const bad = files.map(checkFile).filter(Boolean);
        if (bad.length) toast(bad.join('\n'), 'error', 7000);
        const ok = files.filter(f => !checkFile(f));
        await busy(t.closest('button'), async () => {
          for (const [i, f] of ok.entries()) {
            t.closest('button').lastChild.textContent = ` 올리는 중… (${i + 1}/${ok.length})`;
            const { url } = await uploadImage(f, 'posts');
            gallery.push({ src: url, alt: '', isNew: true });
            drawPhotos();
          }
        }, '올리는 중…');
        markDirty();
      }
    } catch (err) { toast(friendlyError(err), 'error', 6000); }
  });

  let editorStart = editor.getHtml();
  const isDirtyEditor = () => editor.getHtml() !== editorStart;

  function collect(fromOriginal = false) {
    if (fromOriginal) return JSON.parse(original);
    const f = form.elements;
    const title = f.title.value.trim();
    return {
      title,
      category: f.category.value.trim() || '도장소식',
      published_on: f.published_on.value || todayKST(),
      excerpt: f.excerpt.value.trim(),
      cover_url: coverUrl,
      cover_alt: f.cover_alt.value.trim(),
      body_html: editor.getHtml(),
      after_html: buildAfter(post.after_html, { blogUrl: f.blog_url.value.trim(), images: gallery, title }),
      list_title: f.list_title.value.trim() || null,
      list_category: f.list_category.value.trim() || null,
      card_image_url: cardUrl || null,
      card_image_alt: cardUrl ? (post.card_image_url === cardUrl ? post.card_image_alt : title) : null,
      meta_text: f.meta_text.value.trim() || null,
      seo_title: f.seo_title.value.trim() || null,
      is_published: f.is_published.checked,
    };
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = collect();
    if (!data.title) { toast('제목을 입력해 주세요.', 'error'); form.title.focus(); return; }
    const blog = form.blog_url.value.trim();
    if (blog && !/^https?:\/\//.test(blog)) { toast('블로그 링크는 https:// 로 시작해야 합니다.', 'error'); return; }
    // 제목을 바꾸면 예전 "브라우저 탭 제목"은 자동으로 새 제목을 따르도록
    if (!isNew && data.title !== post.title && data.seo_title === post.seo_title) data.seo_title = null;
    await busy($('button[type=submit]', form), async () => {
      try {
        if (isNew) {
          const saved = await db.insertPost({ ...data, slug: newSlug() });
          setDirty(false);
          toast('글을 올렸습니다. 1분 안에 홈페이지에 표시됩니다.');
          go('post', { id: saved.id }, { replace: true });
        } else {
          const saved = await db.updatePost(post.id, post.version, data);
          post = saved;
          gallery = afterImages(parseAfter(saved.after_html));
          drawPhotos();
          editorStart = editor.getHtml();
          setDirty(false);
          toast('저장했습니다. 1분 안에 홈페이지에 반영됩니다.');
        }
      } catch (err) {
        if (isConflict(err)) {
          const reload = await confirmBox('다른 곳에서 먼저 수정됨', '이 글을 연 뒤에 다른 곳(다른 기기 또는 개발자)에서 먼저 수정했습니다.\n최신 내용을 불러오면 지금 입력한 내용은 사라집니다.\n\n지금 입력한 글은 복사해 두신 뒤 불러오기를 눌러 주세요.', '최신 내용 불러오기');
          if (reload) { setDirty(false); go('post', { id: post.id }, { replace: true }); }
        } else toast(friendlyError(err), 'error', 7000);
      }
    }, '저장 중…');
  });
}
