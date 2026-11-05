// 갤러리: 탭(카테고리)별 사진 업로드 · 설명 수정 · 순서 변경 · 삭제(휴지통) · 복구
import { db } from '../api.js';
import { $, esc, toast, confirmBox, modal, busy, friendlyError, isConflict } from '../ui.js';
import { uploadImage, pickFiles, checkFile, previewUrl } from '../upload.js';
import { go } from '../app.js';

const PANES = [
  { id: 'all', label: '🌟 전체' },
  { id: 'france', label: '🇫🇷 프랑스 투어' },
  { id: 'broadcast', label: '📺 방송·시범' },
  { id: 'exam', label: '🏅 승급 심사' },
  { id: 'daily', label: '🏫 도장 일상' },
];

export async function renderGallery(main, params) {
  const pane = PANES.some(p => p.id === params.pane) ? params.pane : params.pane === 'trash' ? 'trash' : 'all';
  const all = await db.listGallery();
  const live = all.filter(g => !g.deleted_at);
  const items = pane === 'trash' ? all.filter(g => g.deleted_at) : live.filter(g => g.pane === pane);

  main.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">갤러리</h1>
      ${pane === 'trash' ? '' : '<button class="btn btn-primary" data-upload>📤 사진 올리기</button>'}
    </div>
    <p class="muted small">홈페이지 갤러리의 탭별 사진입니다. "전체" 탭은 따로 관리됩니다 — 사진을 올릴 때 "전체 탭에도 추가"를 선택할 수 있습니다.</p>
    <div class="tabs scroll">
      ${PANES.map(p => `<a href="#" data-pane="${p.id}" class="${p.id === pane ? 'active' : ''}">${p.label} (${live.filter(g => g.pane === p.id).length})</a>`).join('')}
      <a href="#" data-pane="trash" class="${pane === 'trash' ? 'active' : ''}">🗑 휴지통 (${all.length - live.length})</a>
    </div>
    <div class="photo-admin-grid">
      ${items.map((g, i) => `
        <div class="card photo-card" data-id="${g.id}">
          <div class="photo-thumb"><img src="${esc(g.src)}" alt="" loading="lazy">${g.big ? '<span class="badge">크게</span>' : ''}</div>
          <div class="photo-meta">
            <b>${esc(g.caption || '(캡션 없음)')}</b>
            <small class="muted">${pane === 'trash' ? esc(PANES.find(p => p.id === g.pane)?.label || '') : esc(g.title)}</small>
          </div>
          <div class="photo-actions">
            ${pane === 'trash'
              ? '<button class="btn btn-sm" data-restore>복구</button><button class="btn btn-sm btn-danger" data-purge>영구 삭제</button>'
              : `<button class="btn btn-sm btn-icon" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="앞으로">◀</button>
                 <button class="btn btn-sm btn-icon" data-move="1" ${i === items.length - 1 ? 'disabled' : ''} aria-label="뒤로">▶</button>
                 <button class="btn btn-sm" data-edit>수정</button>
                 <button class="btn btn-sm btn-danger-ghost" data-del>삭제</button>`}
          </div>
        </div>`).join('') || `<div class="card empty">${pane === 'trash' ? '휴지통이 비어 있습니다.' : '이 탭에는 사진이 없습니다.'}</div>`}
    </div>`;

  const reload = () => go('gallery', { pane }, { replace: true });

  main.addEventListener('click', async e => {
    const t = e.target;
    const tab = t.closest('[data-pane]');
    if (tab) { e.preventDefault(); return go('gallery', { pane: tab.dataset.pane }, { replace: true }); }
    if (t.closest('[data-upload]')) return uploadFlow(pane, items, reload);
    const card = t.closest('.photo-card');
    if (!card) return;
    const g = all.find(x => x.id === card.dataset.id);
    try {
      if (t.closest('[data-edit]')) return editFlow(g, reload);
      const mv = t.closest('[data-move]');
      if (mv) {
        const i = items.indexOf(g);
        const j = i + Number(mv.dataset.move);
        const other = items[j];
        if (!other) return;
        // 정렬값 교환 (같은 값이면 위치 기준으로 다시 매김)
        const si = g.sort === other.sort ? i : g.sort;
        const sj = g.sort === other.sort ? j : other.sort;
        await db.updateGallery(g.id, g.version, { sort: sj });
        await db.updateGallery(other.id, other.version, { sort: si });
        return reload();
      }
      if (t.closest('[data-del]')) {
        if (!(await confirmBox('사진 삭제', `"${g.caption || '이 사진'}"을(를) 휴지통으로 옮길까요?\n홈페이지에서 바로 사라지며, 휴지통에서 복구할 수 있습니다.`, '삭제', true))) return;
        await db.updateGallery(g.id, g.version, { deleted_at: new Date().toISOString() });
        toast('휴지통으로 옮겼습니다.');
        return reload();
      }
      if (t.closest('[data-restore]')) {
        await db.updateGallery(g.id, g.version, { deleted_at: null });
        toast('복구했습니다.');
        return reload();
      }
      if (t.closest('[data-purge]')) {
        if (!(await confirmBox('영구 삭제', '이 사진을 영구 삭제할까요? 되돌릴 수 없습니다.', '영구 삭제', true))) return;
        await db.deleteGalleryForever(g.id); // 다른 곳에서 쓰지 않는 사진 파일은 서버가 함께 삭제
        toast('영구 삭제했습니다.');
        return reload();
      }
    } catch (err) {
      toast(isConflict(err) ? '다른 곳에서 먼저 수정되었습니다. 화면을 새로 불러옵니다.' : friendlyError(err), 'error', 6000);
      if (isConflict(err)) reload();
    }
  });
}

async function editFlow(g, reload) {
  const result = await modal({
    title: '사진 정보 수정',
    body: `
      <img class="modal-photo" src="${esc(g.src)}" alt="">
      <label class="field"><span>캡션 <small>(사진 위에 보이는 짧은 글)</small></span><input name="caption" maxlength="300" value="${esc(g.caption)}"></label>
      <label class="field"><span>확대 시 설명 <small>(사진을 눌러 크게 볼 때 표시)</small></span><input name="title" maxlength="300" value="${esc(g.title)}"></label>
      <label class="field"><span>대체 텍스트 <small>(시각장애인용 설명, 비우면 캡션 사용)</small></span><input name="alt" maxlength="300" value="${esc(g.alt)}"></label>
      <label class="check"><input type="checkbox" name="big" ${g.big ? 'checked' : ''}> 크게 보이기 (가로·세로 2칸)</label>`,
    buttons: [
      { label: '취소', value: null },
      {
        label: '저장', kind: 'primary', value: root => ({
          caption: root.querySelector('[name=caption]').value.trim(),
          title: root.querySelector('[name=title]').value.trim(),
          alt: root.querySelector('[name=alt]').value.trim(),
          big: root.querySelector('[name=big]').checked,
        }),
      },
    ],
  });
  if (!result) return;
  try {
    await db.updateGallery(g.id, g.version, result);
    toast('저장했습니다. 1분 안에 홈페이지에 반영됩니다.');
    reload();
  } catch (err) {
    toast(isConflict(err) ? '다른 곳에서 먼저 수정되었습니다. 다시 시도해 주세요.' : friendlyError(err), 'error', 6000);
    reload();
  }
}

async function uploadFlow(pane, items, reload) {
  const files = await pickFiles({ multiple: true });
  if (!files.length) return;
  const bad = files.map(checkFile).filter(Boolean);
  const ok = files.filter(f => !checkFile(f));
  if (bad.length) toast(bad.join('\n'), 'error', 8000);
  if (!ok.length) return;
  const urls = ok.map(previewUrl);
  const paneLabel = PANES.find(p => p.id === pane).label;

  const result = await modal({
    title: `사진 올리기 — ${paneLabel}`,
    wide: true,
    body: `
      <p class="muted small">사진마다 캡션을 입력해 주세요. (나중에 수정할 수 있습니다)</p>
      <div class="upload-list">
        ${ok.map((f, i) => `
          <div class="upload-item">
            <img src="${urls[i]}" alt="">
            <div class="stack">
              <input name="caption" data-i="${i}" placeholder="캡션 (예: 🏅 승급 심사 — 2026)" maxlength="300">
              <input name="title" data-i="${i}" placeholder="확대 시 설명 (선택)" maxlength="300">
            </div>
          </div>`).join('')}
      </div>
      ${pane !== 'all' ? '<label class="check"><input type="checkbox" name="also_all"> "전체" 탭에도 추가</label>' : ''}
      <label class="check"><input type="checkbox" name="front" checked> 맨 앞에 추가 (해제하면 맨 뒤)</label>`,
    buttons: [
      { label: '취소', value: null },
      {
        label: `${ok.length}장 올리기`, kind: 'primary', value: root => ({
          captions: [...root.querySelectorAll('[name=caption]')].map(x => x.value.trim()),
          titles: [...root.querySelectorAll('[name=title]')].map(x => x.value.trim()),
          alsoAll: root.querySelector('[name=also_all]')?.checked,
          front: root.querySelector('[name=front]').checked,
        }),
      },
    ],
  });
  urls.forEach(u => URL.revokeObjectURL(u));
  if (!result) return;

  const btn = $('[data-upload]');
  await busy(btn, async () => {
    const uploaded = [];
    for (const [i, f] of ok.entries()) {
      btn.lastChild.textContent = ` 올리는 중… (${i + 1}/${ok.length})`;
      try {
        const { url, path } = await uploadImage(f, 'gallery');
        uploaded.push({ src: url, storage_path: path, caption: result.captions[i], title: result.titles[i] || result.captions[i], alt: '' });
      } catch (err) {
        toast(`${f.name}: ${friendlyError(err)}`, 'error', 7000);
      }
    }
    if (!uploaded.length) return;
    const all = await db.listGallery();
    const rowsFor = p => {
      const sorts = all.filter(g => g.pane === p && !g.deleted_at).map(g => g.sort);
      const min = sorts.length ? Math.min(...sorts) : 0;
      const max = sorts.length ? Math.max(...sorts) : 0;
      return uploaded.map((u, i) => ({ ...u, pane: p, big: false, sort: result.front ? min - uploaded.length + i : max + 1 + i }));
    };
    try {
      await db.insertGallery(rowsFor(pane));
      if (result.alsoAll) await db.insertGallery(rowsFor('all'));
      toast(`${uploaded.length}장을 올렸습니다. 1분 안에 홈페이지에 반영됩니다.`);
    } catch (err) {
      toast(friendlyError(err), 'error', 7000);
    }
  }, '올리는 중…');
  reload();
}
