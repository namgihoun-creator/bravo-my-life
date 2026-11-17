-- Bravo My Life — Supabase 스키마
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run (여러 번 실행해도 안전: idempotent)

create extension if not exists postgis;

-- ───────────────────────────── 테이블 ─────────────────────────────
create table if not exists public.bml_places (
  id          uuid primary key default gen_random_uuid(),
  kakao_id    text unique,                          -- 카카오 로컬 API 장소 ID (upsert 키)
  mode        text not null check (mode in ('survival', 'nopo')),
  category    text not null,                        -- laundry|print|pharmacy|parking|battery | soup|pocha|solo|general
  extra       text[] not null default '{}',         -- 추가 필터 키 (예: veteran, solo)
  name        text not null,
  address     text,
  phone       text,
  place_url   text,
  badge       text not null default '',             -- "24시" | "업력 38년" | "노포 후보" ...
  tags        text[] not null default '{}',         -- 핵심 스펙 태그 3개
  summary     text not null default '',             -- 한 줄 요약
  lat         double precision not null,
  lng         double precision not null,
  geog        geography(Point, 4326)
              generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  feedback    jsonb not null default '{}'::jsonb,   -- {"ok": 12, "wait": 3}
  source      text not null default 'kakao',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists bml_places_geog_idx on public.bml_places using gist (geog);
create index if not exists bml_places_mode_idx on public.bml_places (mode, category);

-- ───────────────────────────── RLS ─────────────────────────────
-- 읽기는 누구나(anon), 쓰기는 service_role(수집 스크립트) 또는 아래 RPC(피드백)만 가능
alter table public.bml_places enable row level security;

drop policy if exists "bml_places_read" on public.bml_places;
create policy "bml_places_read" on public.bml_places for select using (true);

-- ───────────────────────────── RPC: 주변 장소 ─────────────────────────────
create or replace function public.bml_get_nearby_places(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_m  integer default 2000,
  p_mode      text    default null,
  p_limit     integer default 300
)
returns table (
  id          uuid,
  mode        text,
  category    text,
  extra       text[],
  name        text,
  address     text,
  place_url   text,
  badge       text,
  tags        text[],
  summary     text,
  lat         double precision,
  lng         double precision,
  feedback    jsonb,
  distance_m  double precision
)
language sql
stable
as $$
  select
    p.id, p.mode, p.category, p.extra, p.name, p.address, p.place_url,
    p.badge, p.tags, p.summary, p.lat, p.lng, p.feedback,
    st_distance(p.geog, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) as distance_m
  from public.bml_places p
  where st_dwithin(
          p.geog,
          st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
          least(greatest(p_radius_m, 100), 5000)
        )
    and (p_mode is null or p.mode = p_mode)
  order by distance_m asc
  limit least(greatest(p_limit, 1), 500);
$$;

-- ───────────────────────────── RPC: 현장 피드백 ─────────────────────────────
-- p_delta: +1(누름) / -1(취소). 로그인 없는 서비스라 security definer로 jsonb 카운트만 안전하게 갱신한다.
create or replace function public.bml_update_feedback(
  p_place_id uuid,
  p_key      text,
  p_delta    integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta integer := case when p_delta >= 1 then 1 else -1 end;
  v_new   jsonb;
begin
  if p_key !~ '^[a-z_]{1,20}$' then
    raise exception 'invalid feedback key';
  end if;

  update public.bml_places
     set feedback = jsonb_set(
           feedback,
           array[p_key],
           to_jsonb(greatest(0, coalesce((feedback ->> p_key)::int, 0) + v_delta)),
           true
         )
   where id = p_place_id
  returning feedback into v_new;

  return v_new;
end;
$$;

grant execute on function public.bml_get_nearby_places(double precision, double precision, integer, text, integer) to anon, authenticated;
grant execute on function public.bml_update_feedback(uuid, text, integer) to anon, authenticated;
