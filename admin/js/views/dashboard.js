// 대시보드: 바로가기와 현황
import { db } from '../api.js';
import { esc, fmtDateTime, fmtDate } from '../ui.js';
import { go } from '../app.js';

export async function renderDashboard(main) {
  const [posts, gallery, revs] = await Promise.all([db.listPosts(), db.listGallery(), db.listRevisions(5)]);
  const live = posts.filter(p => !p.deleted_at);
  const photos = gallery.filter(g => !g.deleted_at);
  const recent = [...live].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);

  main.innerHTML = `
    <h1 class="page-title">관장님, 안녕하세요 👋</h1>
    <p class="muted">무엇을 수정하시겠어요? 저장한 내용은 1분 안에 홈페이지에 반영됩니다.</p>

    <div class="quick-grid">
      <button class="quick" data-go="post" data-new="1"><span class="ico">✍️</span><b>새 소식 쓰기</b><small>도장 소식에 글 올리기</small></button>
      <button class="quick" data-go="gallery"><span class="ico">📸</span><b>사진 올리기</b><small>갤러리 사진 관리</small></button>
      <button class="quick" data-go="pages"><span class="ico">📝</span><b>페이지 문구 수정</b><small>인사말·소개글·메인 화면</small></button>
    </div>

    <div class="stat-row">
      <div class="card stat"><span>도장 소식</span><b>${live.length}</b><small>개</small></div>
      <div class="card stat"><span>갤러리 사진</span><b>${photos.length}</b><small>장</small></div>
    </div>

    <section class="card">
      <h2>최근 수정한 소식</h2>
      <ul class="simple-list">
        ${recent.map(p => `<li><a href="#" data-post="${p.id}">${esc(p.title)}</a><small>${fmtDate(p.published_on)} · 수정 ${fmtDateTime(p.updated_at)}</small></li>`).join('') || '<li class="muted">아직 없습니다</li>'}
      </ul>
      ${revs.length ? `<p class="muted small">마지막 변경: ${fmtDateTime(revs[0].changed_at)} · <a href="#" data-go="history">변경 기록 보기</a></p>` : ''}
    </section>`;

  main.addEventListener('click', e => {
    const q = e.target.closest('[data-go]');
    if (q) { e.preventDefault(); return go(q.dataset.go, q.dataset.new ? { id: 'new' } : {}); }
    const p = e.target.closest('[data-post]');
    if (p) { e.preventDefault(); go('post', { id: p.dataset.post }); }
  });
}
