// Supabase REST 호출 공통 헤더.
// 새 secret 키(sb_secret_…)는 apikey 헤더만, 예전 service_role 키(JWT)는 Authorization 도 함께 보낸다.
export function supabaseHeaders(key, extra = {}) {
  return { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }), ...extra };
}
