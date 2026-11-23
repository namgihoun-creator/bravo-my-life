-- 007: '이 동네 데이터 요청하기' — 미지원 지역(가장 가까운 거점 30km 밖) 요청 집계
-- Supabase SQL Editor 에서 실행하세요 (여러 번 실행해도 안전: idempotent).
--
-- 개인정보 최소화: 정확한 GPS 는 저장하지 않고 0.02° 격자 중심(lat_c, lng_c)만 저장한다.
--   voter_hash = sha256(IP + User-Agent + 서버 salt) — 같은 사람의 중복 요청을 1표로 세기 위한 일방향 값(IP 원문은 저장 안 함).
-- 접근: RLS 를 켜고 정책을 만들지 않으므로 anon/authenticated 는 읽기·쓰기 모두 불가.
--       서버 라우트(POST /api/area-requests)만 service role 키로 insert 한다.
-- 집계 예:
--   select cell_key, max(area_name) as area_name, max(nearest_hub) as nearest_hub, count(*) as votes, max(created_at) as last_at
--     from public.bml_area_requests group by cell_key order by votes desc, last_at desc;

create table if not exists public.bml_area_requests (
  id             uuid primary key default gen_random_uuid(),
  cell_key       text not null,                       -- 0.02° 격자 인덱스 '위도칸_경도칸'
  voter_hash     text not null,                       -- 일방향 해시(복원 불가)
  lat_c          double precision not null,           -- 격자 중심 위도
  lng_c          double precision not null,           -- 격자 중심 경도
  area_name      text,                                -- 카카오 coord2regioncode 행정동 이름(실패 시 null)
  nearest_hub    text,                                -- 가장 가까운 지원 거점 이름
  nearest_hub_m  integer,                             -- 그 거점까지 거리(m)
  created_at     timestamptz not null default now(),
  constraint bml_area_requests_cell_voter_key unique (cell_key, voter_hash),
  constraint bml_area_requests_cell_key_len check (char_length(cell_key) <= 24),
  constraint bml_area_requests_hash_len check (char_length(voter_hash) = 64)
);

alter table public.bml_area_requests enable row level security;

-- 정책을 만들지 않는다(= anon 차단). 혹시 기본 권한이 열려 있어도 명시적으로 회수한다.
revoke all on table public.bml_area_requests from anon, authenticated;
