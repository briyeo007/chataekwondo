// 로그인 · 비밀번호 만들기(일회용 링크) · 복구 코드로 재설정 화면
import * as api from '../api.js';
import { $, esc, toast, busy } from '../ui.js';

function frame(inner) {
  return `<div class="auth-wrap"><div class="card auth-card">
    <img class="auth-logo" src="/logo-01.png" alt="차 태권도">
    ${inner}
  </div></div>`;
}

const pwField = (name, label, auto) => `
  <label class="field"><span>${label}</span>
    <div class="pw-wrap"><input type="password" name="${name}" autocomplete="${auto}" required>
    <button type="button" class="pw-toggle" aria-label="비밀번호 보기">보기</button></div></label>`;

function bindPwToggle(root) {
  root.querySelectorAll('.pw-toggle').forEach(btn => btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '숨기기' : '보기';
  }));
}

function errorBox(root) {
  const el = $('.form-error', root);
  return m => { el.textContent = m || ''; el.hidden = !m; };
}

export function renderLogin(root, onSignedIn) {
  root.innerHTML = frame(`
    <h1>홈페이지 관리자 로그인</h1>
    <form class="stack" novalidate>
      <label class="field"><span>아이디</span>
        <input type="text" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
      ${pwField('password', '비밀번호', 'current-password')}
      <label class="check"><input type="checkbox" name="remember"> 로그인 상태 유지 (내 휴대폰·PC에서만 선택하세요)</label>
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">로그인</button>
      <a class="link-sm" href="/admin/?v=recover" data-recover>비밀번호를 잊으셨나요?</a>
    </form>`);
  const form = $('form', root);
  const show = errorBox(root);
  bindPwToggle(root);
  $('[data-recover]', root).addEventListener('click', e => { e.preventDefault(); renderRecover(root, onSignedIn); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) return show('아이디와 비밀번호를 입력해 주세요.');
    show('');
    await busy($('button[type=submit]', form), async () => {
      try {
        await api.login(username, password, form.remember.checked);
        onSignedIn();
      } catch (ex) {
        show(ex.code === 'network' ? '인터넷 연결을 확인해 주세요.' : ex.message);
        form.password.select();
      }
    }, '로그인 중…');
  });
  form.username.focus();
}

/** 새 비밀번호 + 확인 입력 폼 공통 처리 */
function passwordForm(root, extraFields, submitLabel, onSubmit) {
  const form = $('form', root);
  const show = errorBox(root);
  bindPwToggle(root);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const problem = api.passwordProblem(form.pw.value, form.pw2.value);
    if (problem) return show(problem);
    show('');
    await busy($('button[type=submit]', form), async () => {
      try { await onSubmit(form); } catch (ex) { show(ex.code === 'network' ? '인터넷 연결을 확인해 주세요.' : ex.message); }
    }, '저장 중…');
  });
}

const NEW_PW_FIELDS = `
  ${pwField('pw', '새 비밀번호 <small>(10자 이상, 영문+숫자)</small>', 'new-password')}
  <label class="field"><span>새 비밀번호 확인</span><input type="password" name="pw2" autocomplete="new-password" required></label>`;

export function renderSetup(root, token, onDone) {
  root.innerHTML = frame(`
    <h1>관리자 비밀번호 만들기</h1>
    <p class="muted">앞으로 관리자 페이지에 로그인할 때 쓸 비밀번호를 직접 만들어 주세요.
      비밀번호는 암호화되어 저장되므로 개발자를 포함해 누구도 볼 수 없습니다.</p>
    <p>로그인 아이디: <b>master</b></p>
    <form class="stack" novalidate>
      ${NEW_PW_FIELDS}
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">비밀번호 저장</button>
    </form>`);
  passwordForm(root, '', '', async form => {
    const { recoveryCode } = await api.setupPassword(token, form.pw.value);
    renderRecoveryCode(root, recoveryCode, onDone, '비밀번호가 저장되었습니다');
  });
}

export function renderRecover(root, onDone) {
  history.replaceState(null, '', '/admin/?v=recover');
  root.innerHTML = frame(`
    <h1>비밀번호 재설정</h1>
    <p class="muted">비밀번호를 만들 때 받은 <b>복구 코드</b>로 새 비밀번호를 설정할 수 있습니다.
      복구 코드가 없으면 개발자에게 새 설정 링크를 요청해 주세요.</p>
    <form class="stack" novalidate>
      <label class="field"><span>아이디</span><input type="text" name="username" value="master" autocomplete="username" autocapitalize="off" required></label>
      <label class="field"><span>복구 코드</span><input type="text" name="code" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autocapitalize="characters" autocomplete="off" spellcheck="false" required></label>
      ${NEW_PW_FIELDS}
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">새 비밀번호 저장</button>
      <a class="link-sm" href="/admin/" data-back>← 로그인으로 돌아가기</a>
    </form>`);
  $('[data-back]', root).addEventListener('click', e => { e.preventDefault(); history.replaceState(null, '', '/admin/'); renderLogin(root, onDone); });
  passwordForm(root, '', '', async form => {
    if (!form.code.value.trim()) throw new Error('복구 코드를 입력해 주세요.');
    const { recoveryCode } = await api.recover(form.username.value.trim(), form.code.value, form.pw.value);
    history.replaceState(null, '', '/admin/');
    renderRecoveryCode(root, recoveryCode, onDone, '새 비밀번호가 저장되었습니다');
  });
}

/** 복구 코드 안내 (한 번만 표시) */
export function renderRecoveryCode(root, code, onDone, title) {
  root.innerHTML = frame(`
    <h1>${esc(title)}</h1>
    <p>비밀번호를 잊었을 때 쓰는 <b>복구 코드</b>입니다. <b>지금 한 번만</b> 보여 드리니 종이에 적거나 사진을 찍어 안전한 곳에 보관해 주세요.</p>
    <div class="recovery-code" aria-label="복구 코드">${esc(code)}</div>
    <button type="button" class="btn btn-block" data-copy>복사하기</button>
    <p class="muted small">복구 코드는 한 번 쓰면 새 코드로 바뀝니다. 계정 설정에서 언제든 새로 만들 수 있습니다.</p>
    <label class="check"><input type="checkbox" data-ok> 복구 코드를 안전한 곳에 보관했습니다</label>
    <button type="button" class="btn btn-primary btn-block" data-done disabled>관리자 화면으로</button>`);
  $('[data-copy]', root).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); toast('복사했습니다.'); } catch { toast('복사하지 못했습니다. 직접 적어 주세요.', 'error'); }
  });
  $('[data-ok]', root).addEventListener('change', e => { $('[data-done]', root).disabled = !e.target.checked; });
  $('[data-done]', root).addEventListener('click', onDone);
}

export function renderLinkError(root) {
  root.innerHTML = frame(`
    <h1>링크를 사용할 수 없습니다</h1>
    <p>링크의 유효시간(24시간)이 지났거나 이미 사용한 링크입니다.</p>
    <p class="muted">비밀번호 설정 링크는 보안을 위해 한 번만 쓸 수 있습니다. 개발자에게 새 링크를 요청해 주세요.</p>
    <a class="btn btn-primary btn-block" href="/admin/">로그인 화면으로</a>`);
}
