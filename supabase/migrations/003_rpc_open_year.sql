-- bml_get_nearby_places 가 open_year(인허가 연도)를 함께 돌려주도록 변경
-- 실행: Supabase SQL Editor (002_open_year.sql 이후, 여러 번 실행해도 안전)
-- 프론트는 open_year가 없으면 뱃지 텍스트('업력 N년')로 대체하므로 실행 전에도 동작하지만,
-- 해가 바뀌어도 업력이 자동으로 정확해지려면 이 마이그레이션이 필요하다.

alter table public.bml_places add column if not exists open_year integer;

-- 반환 컬럼이 바뀌므로 기존 함수를 지우고 다시 만든다
drop function if exists public.bml_get_nearby_places(double precision, double precision, integer, text, integer);

create function public.bml_get_nearby_places(
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
  open_year   integer,
  distance_m  double precision
)
language sql
stable
as $$
  select
    p.id, p.mode, p.category, p.extra, p.name, p.address, p.place_url,
    p.badge, p.tags, p.summary, p.lat, p.lng, p.feedback, p.open_year,
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

grant execute on function public.bml_get_nearby_places(double precision, double precision, integer, text, integer) to anon, authenticated;
