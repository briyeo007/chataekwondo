// 변경 기록: 최근 수정·삭제 내역과 "이전 내용으로 되돌리기"
import { db } from '../api.js';
import { esc, toast, confirmBox, fmtDateTime, friendlyError } from '../ui.js';
import { go } from '../app.js';
import { PAGE_INFO } from './pages.js';

const TABLE = {
  content_blocks: { label: '페이지 문구', name: d => `${PAGE_INFO[d.page]?.label || d.page} › ${d.label}` },
  posts: { label: '도장 소식', name: d => d.title },
  gallery_items: { label: '갤러리', name: d => d.caption || d.src.split('/').pop() },
};

function describe(rev) {
  const d = rev.old_data;
  if (rev.op === 'delete') return '영구 삭제됨';
  if (rev.table_name !== 'content_blocks' && d.deleted_at) return '휴지통에서 꺼내기 전 상태';
  return '수정 전 내용';
}

export async function renderHistory(main) {
  const revs = await db.listRevisions(150);
  main.innerHTML = `
    <h1 class="page-title">변경 기록</h1>
    <p class="muted">저장하거나 삭제할 때마다 그 직전 내용이 자동으로 보관됩니다. 실수로 바꾼 내용을 되돌릴 수 있습니다. (최근 150건)</p>
    <div class="history-list">
      ${revs.map(r => {
        const t = TABLE[r.table_name];
        return `<div class="card history-row" data-id="${r.id}">
          <div><span class="badge badge-gray">${esc(t?.label || r.table_name)}</span> <b>${esc(t ? t.name(r.old_data) : r.row_key)}</b>
          <small class="muted">${fmtDateTime(r.changed_at)} · ${describe(r)}</small>
          ${r.table_name === 'content_blocks' ? `<details><summary>보관된 내용 보기</summary><pre>${esc(String(r.old_data.value).slice(0, 2000))}</pre></details>` : ''}</div>
          <button class="btn btn-sm" data-restore>이 내용으로 되돌리기</button>
        </div>`;
      }).join('') || '<div class="card empty">아직 변경 기록이 없습니다.</div>'}
    </div>`;

  main.addEventListener('click', async e => {
    const btn = e.target.closest('[data-restore]');
    if (!btn) return;
    const rev = revs.find(r => String(r.id) === btn.closest('.history-row').dataset.id);
    const t = TABLE[rev.table_name];
    if (!(await confirmBox('되돌리기', `"${t.name(rev.old_data)}"\n${fmtDateTime(rev.changed_at)} 이전 내용으로 되돌릴까요?\n(지금 내용도 변경 기록에 보관됩니다)`, '되돌리기'))) return;
    try {
      await db.restoreRevision(rev.id);
      toast('되돌렸습니다. 1분 안에 홈페이지에 반영됩니다.');
      go('history', {}, { replace: true });
    } catch (err) { toast(friendlyError(err), 'error', 7000); }
  });
}
