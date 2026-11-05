-- ─────────────────────────────────────────────────────────────
-- 차태권도 관리자(CMS) Supabase 설정
-- Supabase → SQL Editor 에 이 파일 내용 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전합니다 (기존 데이터·테이블을 지우지 않음).
--
-- 접근은 Vercel 서버(secret / service_role 키)만 가능합니다.
-- 공개키(anon)로는 테이블을 읽거나 쓸 수 없고, 사진 버킷은 "읽기"만 공개입니다.
-- ─────────────────────────────────────────────────────────────

-- 1) 콘텐츠·계정 데이터 (키-값)
create table if not exists public.cms_kv (
  key        text primary key,
  value      text not null,
  expires_at timestamptz            -- 일회용 링크 등 만료 시각 (없으면 영구)
);

-- 2) 변경 기록 (최근 500건 유지)
create table if not exists public.cms_revisions (
  id         bigint generated always as identity primary key,
  list_key   text not null,
  value      text not null,
  created_at timestamptz not null default now()
);
create index if not exists cms_revisions_list_idx on public.cms_revisions (list_key, id desc);

-- 3) 보안: 행 수준 보안(RLS) 켜고 정책은 만들지 않음 → 서버 키 외에는 접근 불가
alter table public.cms_kv enable row level security;
alter table public.cms_revisions enable row level security;
revoke all on table public.cms_kv, public.cms_revisions from anon, authenticated;

-- 4) 저장: "버전이 같을 때만" 콘텐츠 문서를 원자적으로 교체 (동시 수정 충돌 방지)
--    성공하면 새 버전 번호, 다른 곳에서 먼저 저장했으면 -1
create or replace function public.cms_cas(
  p_ver_key  text,
  p_doc_key  text,
  p_rev_key  text,
  p_expect   text,
  p_doc      text,
  p_sets     jsonb  default '{}'::jsonb,   -- { 키: 값 } 함께 저장할 글 본문
  p_dels     text[] default '{}'::text[],  -- 함께 삭제할 키
  p_revs     text[] default '{}'::text[],  -- 추가할 변경 기록
  p_max_revs int    default 500
) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  cur text;
  nv  bigint;
  k   text;
  v   text;
  r   text;
begin
  perform pg_advisory_xact_lock(hashtext(p_ver_key));

  select value into cur from public.cms_kv
   where key = p_ver_key and (expires_at is null or expires_at > now());
  if coalesce(cur, '0') <> p_expect then
    return -1;
  end if;
  nv := coalesce(cur, '0')::bigint + 1;

  insert into public.cms_kv (key, value, expires_at) values (p_doc_key, p_doc, null)
    on conflict (key) do update set value = excluded.value, expires_at = null;
  insert into public.cms_kv (key, value, expires_at) values (p_ver_key, nv::text, null)
    on conflict (key) do update set value = excluded.value, expires_at = null;

  for k, v in select e.key, e.value from jsonb_each_text(coalesce(p_sets, '{}'::jsonb)) as e loop
    insert into public.cms_kv (key, value, expires_at) values (k, v, null)
      on conflict (key) do update set value = excluded.value, expires_at = null;
  end loop;

  delete from public.cms_kv where key = any (coalesce(p_dels, '{}'::text[]));

  if coalesce(array_length(p_revs, 1), 0) > 0 then
    foreach r in array p_revs loop
      insert into public.cms_revisions (list_key, value) values (p_rev_key, r);
    end loop;
    delete from public.cms_revisions
     where list_key = p_rev_key
       and id < (select min(t.id) from (
             select id from public.cms_revisions
              where list_key = p_rev_key order by id desc limit p_max_revs) t);
  end if;

  return nv;
end;
$$;

revoke all on function public.cms_cas(text, text, text, text, text, jsonb, text[], text[], int) from public, anon, authenticated;
grant execute on function public.cms_cas(text, text, text, text, text, jsonb, text[], text[], int) to service_role;

-- 5) 사진 저장소
--    cms-media   : 홈페이지 사진 (공개 읽기, 업로드는 서버만, 최대 5MB, JPEG/PNG/WebP)
--    cms-backups : 매일 자동 백업 (비공개, 암호화된 파일)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cms-media', 'cms-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('cms-backups', 'cms-backups', false, 52428800)
on conflict (id) do nothing;

-- 확인용: 아래 결과에 테이블 2개, 버킷 2개가 보이면 성공
select 'table' as kind, table_name as name from information_schema.tables
 where table_schema = 'public' and table_name in ('cms_kv', 'cms_revisions')
union all
select 'bucket', id from storage.buckets where id in ('cms-media', 'cms-backups');
