// 관리자 API 호출. 로그인은 서버의 HttpOnly 쿠키로 유지되며, 권한 검사는 서버에서 한다.

class ApiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

async function call(method, path, body, { raw = false, contentType } = {}) {
  let res;
  try {
    res = await fetch(`/api/admin/${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-CMS': '1',
        ...(body !== undefined ? { 'Content-Type': contentType || 'application/json' } : {}),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Failed to fetch');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data.error || 'error', data.message || `오류 (${res.status})`);
    if (res.status === 401 && !['login', 'setup', 'recover'].includes(path.split('?')[0])) onUnauthorized?.(err);
    throw err;
  }
  return data;
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

/* ── 인증 ─────────────────────────────────────────────── */
export const status = () => call('GET', 'status');
export async function me() {
  try { return await call('GET', 'me'); } catch (e) { if (e.status === 401) return null; throw e; }
}
export const login = (username, password, remember) => call('POST', 'login', { username, password, remember });
export const logout = () => call('POST', 'logout', {});
export const logoutAll = () => call('POST', 'logout-all', {});
export const checkSetupToken = token => call('GET', `setup-check?token=${encodeURIComponent(token)}`);
export const setupPassword = (token, password) => call('POST', 'setup', { token, password });
export const recover = (username, code, password) => call('POST', 'recover', { username, code, password });
export const changePassword = (current, next) => call('POST', 'password', { current, next });
export const newRecoveryCode = current => call('POST', 'recovery-code', { current });

export function passwordProblem(pw, pw2) {
  if (pw.length < 10) return '비밀번호는 10자 이상이어야 합니다.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 모두 포함해 주세요.';
  if (pw.toLowerCase().includes('master')) return '아이디가 들어간 비밀번호는 사용할 수 없습니다.';
  if (pw2 !== undefined && pw !== pw2) return '두 비밀번호가 서로 다릅니다.';
  return null;
}

/* ── 데이터 ─────────────────────────────────────────────── */
export const db = {
  // 글
  listPosts: () => call('GET', 'posts'),
  getPost: id => call('GET', `post?id=${encodeURIComponent(id)}`),
  insertPost: row => call('POST', 'post', row),
  updatePost: (id, version, patch) => call('PATCH', 'post', { id, version, patch }),
  deletePostForever: id => call('DELETE', `post?id=${encodeURIComponent(id)}`),

  // 갤러리
  listGallery: () => call('GET', 'gallery'),
  insertGallery: rows => call('POST', 'gallery', { rows }),
  updateGallery: (id, version, patch) => call('PATCH', 'gallery', { id, version, patch }),
  deleteGalleryForever: id => call('DELETE', `gallery?id=${encodeURIComponent(id)}`),

  // 페이지 블록
  listBlocks: page => call('GET', `blocks?page=${encodeURIComponent(page)}`),
  allBlocksMeta: () => call('GET', 'blocks-meta'),
  updateBlock: (key, version, patch) => call('PATCH', 'block', { key, version, patch }),

  // 변경 기록
  listRevisions: (limit = 150) => call('GET', `revisions?limit=${limit}`),
  restoreRevision: id => call('POST', 'restore', { id }),

  // 사진 업로드 (JPEG Blob)
  upload: (blob, folder) => call('POST', `upload?folder=${encodeURIComponent(folder)}`, blob, { raw: true, contentType: 'image/jpeg' }),
};
