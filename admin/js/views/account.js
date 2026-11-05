// 계정 설정: 비밀번호 변경, 복구 코드 새로 만들기, 로그아웃
import * as api from '../api.js';
import { $, esc, toast, busy, confirmBox, fmtDateTime, modal } from '../ui.js';

function showCode(code, title) {
  return modal({
    title,
    body: `<p>새 복구 코드입니다. <b>지금 한 번만</b> 보여 드리니 안전한 곳에 적어 두세요. 이전 복구 코드는 더 이상 쓸 수 없습니다.</p>
      <div class="recovery-code">${esc(code)}</div>`,
    buttons: [{ label: '적어 두었습니다', value: true, kind: 'primary' }],
  });
}

export async function renderAccount(main) {
  const user = await api.me();
  main.innerHTML = `
    <h1 class="page-title">계정 설정</h1>
    <section class="card stack">
      <h2>내 계정</h2>
      <p>로그인 아이디: <b>${esc(user.username)}</b></p>
      <p class="muted small">마지막 로그인: ${fmtDateTime(user.last_login)} · 비밀번호 설정: ${fmtDateTime(user.password_set_at)}</p>
    </section>

    <section class="card stack">
      <h2>비밀번호 변경</h2>
      <form class="stack pw-form" novalidate>
        <label class="field"><span>현재 비밀번호</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="field"><span>새 비밀번호 <small>(10자 이상, 영문+숫자)</small></span><input type="password" name="pw" autocomplete="new-password" required></label>
        <label class="field"><span>새 비밀번호 확인</span><input type="password" name="pw2" autocomplete="new-password" required></label>
        <p class="form-error" hidden></p>
        <div><button class="btn btn-primary" type="submit">비밀번호 변경</button></div>
      </form>
      <p class="muted small">비밀번호를 바꾸면 복구 코드도 새로 만들어지고, 다른 기기는 모두 로그아웃됩니다.</p>
    </section>

    <section class="card stack">
      <h2>복구 코드</h2>
      <p class="muted small">비밀번호를 잊었을 때 로그인 화면의 "비밀번호를 잊으셨나요?"에서 사용합니다. 잃어버렸다면 새로 만들어 주세요.</p>
      <div><button class="btn" data-new-code>복구 코드 새로 만들기</button></div>
    </section>

    <section class="card stack">
      <h2>로그아웃</h2>
      <p class="muted small">다른 기기(예: 도장 PC)에서 로그아웃하지 않았다면 "모든 기기에서 로그아웃"을 눌러 주세요.</p>
      <div class="btn-row">
        <button class="btn" data-logout>이 기기에서 로그아웃</button>
        <button class="btn btn-danger-ghost" data-logout-all>모든 기기에서 로그아웃</button>
      </div>
    </section>`;

  const form = $('.pw-form', main);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('.form-error', form);
    const show = m => { err.textContent = m; err.hidden = !m; };
    if (!form.current.value) return show('현재 비밀번호를 입력해 주세요.');
    const problem = api.passwordProblem(form.pw.value, form.pw2.value);
    if (problem) return show(problem);
    show('');
    await busy($('button[type=submit]', form), async () => {
      try {
        const { recoveryCode } = await api.changePassword(form.current.value, form.pw.value);
        form.reset();
        toast('비밀번호를 변경했습니다.');
        await showCode(recoveryCode, '비밀번호 변경 완료');
      } catch (ex) { show(ex.message); }
    }, '변경 중…');
  });

  main.addEventListener('click', async e => {
    if (e.target.closest('[data-new-code]')) {
      const current = await modal({
        title: '복구 코드 새로 만들기',
        body: '<label class="field"><span>현재 비밀번호</span><input type="password" class="cur-pw" autocomplete="current-password"></label>',
        buttons: [{ label: '취소', value: null }, { label: '만들기', kind: 'primary', value: r => r.querySelector('.cur-pw').value }],
      });
      if (!current) return;
      try { await showCode((await api.newRecoveryCode(current)).recoveryCode, '새 복구 코드'); } catch (ex) { toast(ex.message, 'error', 6000); }
    }
    if (e.target.closest('[data-logout]')) {
      await api.logout().catch(() => {});
      location.href = '/admin/';
    }
    if (e.target.closest('[data-logout-all]')) {
      if (!(await confirmBox('모든 기기에서 로그아웃', '이 기기를 포함한 모든 기기에서 로그아웃됩니다.', '로그아웃'))) return;
      await api.logoutAll().catch(() => {});
      location.href = '/admin/';
    }
  });
}
