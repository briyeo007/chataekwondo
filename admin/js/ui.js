// 공통 UI 도우미: 이스케이프, 알림(토스트), 확인 창, 입력 창, 로딩 표시, 날짜 형식.

export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(message, type = 'ok', ms = 3500) {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, ms);
}

/** 모달 창. buttons: [{label, value, kind}] → 누른 버튼의 value */
export function modal({ title, body = '', buttons = [{ label: '확인', value: true, kind: 'primary' }], onOpen, wide }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${esc(title)}</h3>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          ${buttons.map((b, i) => `<button type="button" class="btn ${b.kind ? 'btn-' + b.kind : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}
        </div>
      </div>`;
    const close = v => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(undefined); };
    back.addEventListener('click', e => {
      if (e.target === back) return close(undefined);
      const btn = e.target.closest('.modal-actions button');
      if (btn) {
        const b = buttons[+btn.dataset.i];
        close(typeof b.value === 'function' ? b.value(back) : b.value);
      }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    onOpen?.(back);
    (back.querySelector('input, textarea, select') || back.querySelector('.btn-primary') || back.querySelector('button'))?.focus();
  });
}

export function confirmBox(title, message, okLabel = '확인', danger = false) {
  return modal({
    title,
    body: `<p>${esc(message).replace(/\n/g, '<br>')}</p>`,
    buttons: [
      { label: '취소', value: false },
      { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
}

export function promptBox(title, label, value = '', placeholder = '') {
  return modal({
    title,
    body: `<label class="field"><span>${esc(label)}</span><input type="text" class="prompt-input" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`,
    buttons: [
      { label: '취소', value: null },
      { label: '확인', value: root => root.querySelector('.prompt-input').value.trim(), kind: 'primary' },
    ],
    onOpen: root => root.querySelector('.prompt-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') root.querySelector('.btn-primary').click();
    }),
  });
}

/** 버튼을 누르는 동안 비활성화 + "처리 중" 표시 */
export async function busy(btn, fn, label = '처리 중…') {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${esc(label)}`;
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function todayKST() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

/** 서버 오류 → 관장님이 이해할 수 있는 문장 */
export function friendlyError(err) {
  const m = String(err?.message || err || '');
  if (err?.code === 'version_conflict') return '다른 곳에서 먼저 수정된 내용이 있습니다. 최신 내용을 다시 불러온 뒤 수정해 주세요.';
  if (err?.status === 401) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
  if (err?.status === 403) return '허용되지 않은 요청입니다. 페이지를 새로고침해 주세요.';
  if (err?.code === 'busy') return '잠시 후 다시 시도해 주세요.';
  if (err?.status === 400 || err?.status === 404 || err?.status === 409) return m;
  if (/Failed to fetch|NetworkError|network/i.test(m)) return '인터넷 연결을 확인해 주세요.';
  if (err?.status === 413) return '파일 크기가 너무 큽니다.';
  if (/mime type|invalid_mime/i.test(m)) return '지원하지 않는 파일 형식입니다 (JPG, PNG, WEBP만 가능).';
  return `오류가 발생했습니다: ${m}`;
}

export function isConflict(err) {
  return err?.code === 'version_conflict';
}
