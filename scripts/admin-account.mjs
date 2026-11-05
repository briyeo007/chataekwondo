// 관장님 관리자 계정 관리 (개발자 전용).
//   npm run admin -- link         비밀번호 설정 링크 발급 (최초 설정 · 분실 시, 24시간 동안 한 번만 사용 가능)
//   npm run admin -- status       계정 상태 (비밀번호 설정 여부, 마지막 로그인, 잠금)
//   npm run admin -- unlock       로그인 잠금 해제 (5회 실패 시 15분 잠금)
//   npm run admin -- logout-all   모든 기기에서 강제 로그아웃 (분실·도용 의심 시)
// 비밀번호와 복구 코드는 이 명령으로 볼 수도, 정할 수도 없습니다 (관장님만 알 수 있음).
import { loadEnv, api, positional, confirm, fail } from './lib/remote.mjs';

const site = loadEnv();
const [cmd] = positional();
const when = iso => (iso ? new Date(iso).toLocaleString('ko-KR') : '없음');

try {
  switch (cmd) {
    case 'link': {
      const s = await api('GET', 'admin-status');
      if (s.password_set && !(await confirm('관장님이 이미 비밀번호를 설정했습니다. 새 링크로 비밀번호를 다시 정하게 됩니다.'))) process.exit(0);
      const { token } = await api('POST', 'admin-link');
      console.log('\n관장님께 아래 링크를 보내 주세요 (카카오톡 등). 24시간 동안 한 번만 사용할 수 있습니다.\n');
      console.log(`  ${site}/admin/?setup=${token}\n`);
      console.log('  로그인 아이디: master');
      console.log('  관장님이 링크에서 비밀번호를 만들면 복구 코드가 표시됩니다 → 꼭 보관하시도록 안내해 주세요.');
      break;
    }
    case 'status': {
      const s = await api('GET', 'admin-status');
      console.log(`아이디: ${s.username}`);
      console.log(`비밀번호: ${s.password_set ? `설정됨 (${when(s.password_set_at)})` : '아직 설정 안 됨 → npm run admin -- link'}`);
      console.log(`마지막 로그인: ${when(s.last_login)}`);
      console.log(`잠금: ${s.locked ? `잠김 (${when(s.lock_until)}까지) → npm run admin -- unlock` : '없음'}${s.fail ? ` · 연속 실패 ${s.fail}회` : ''}`);
      break;
    }
    case 'unlock':
      await api('POST', 'admin-unlock');
      console.log('✓ 로그인 잠금을 해제했습니다.');
      break;
    case 'logout-all':
      if (!(await confirm('모든 기기의 관리자 로그인을 끊습니다.'))) process.exit(0);
      await api('POST', 'admin-logout-all');
      console.log('✓ 모든 기기에서 로그아웃되었습니다. 의심되면 npm run admin -- link 로 비밀번호도 새로 정하게 하세요.');
      break;
    default:
      console.log('사용법: npm run admin -- <link|status|unlock|logout-all> [--env 파일]');
  }
} catch (e) { fail(e); }
