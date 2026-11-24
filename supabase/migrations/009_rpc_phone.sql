-- 009: bml_get_nearby_places 가 노포의 대표 전화(phone)를 함께 돌려주도록 변경 (목록 카드 '전화' 버튼용)
-- Supabase SQL Editor 에서 실행하세요 (drop → create 라 여러 번 실행해도 안전: idempotent).
--
-- 개인정보 최소화: 노포(mode='nopo')만, 그리고 유선·대표번호 형태(9~11자리 숫자·하이픈, 010 등 휴대폰 제외)만 내려준다.
--   상세 페이지의 telHref 와 같은 기준이며, 휴대폰으로 보이는 번호는 응답에 아예 싣지 않는다(오프라인 캐시에도 남지 않음).
-- 이 마이그레이션 전에도 앱은 동작한다(phone 이 없으면 카드의 전화 버튼만 숨는다).

drop function if exists public.bml_get_nearby_places(double precision, double precision, integer, text, integer);

create function public.bml_get_nearby_places(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_m  integer default 2000,
  p_mode      text    default null,
  p_limit     integer default 300
)
returns table (
  id              uuid,
  mode            text,
  category        text,
  extra           text[],
  name            text,
  address         text,
  place_url       text,
  badge           text,
  tags            text[],
  summary         text,
  lat             double precision,
  lng             double precision,
  feedback        jsonb,
  open_year       integer,
  distance_m      double precision,
  last_synced_at  timestamptz,
  reported_issue  text,
  closure_reports integer,
  phone           text
)
language sql
stable
as $$
  select
    p.id, p.mode, p.category, p.extra, p.name, p.address, p.place_url,
    p.badge, p.tags, p.summary, p.lat, p.lng, p.feedback, p.open_year,
    st_distance(p.geog, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) as distance_m,
    p.last_synced_at, p.reported_issue, p.closure_reports,
    case
      when p.mode = 'nopo'
       and p.phone ~ '^[0-9][0-9-]*$'
       and regexp_replace(p.phone, '-', '', 'g') !~ '^01[016789]'
       and length(regexp_replace(p.phone, '-', '', 'g')) between 9 and 11
      then p.phone
      else null
    end as phone
  from public.bml_places p
  where p.is_active
    and st_dwithin(
          p.geog,
          st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
          least(greatest(p_radius_m, 100), 5000)
        )
    and (p_mode is null or p.mode = p_mode)
  order by distance_m asc
  limit least(greatest(p_limit, 1), 500);
$$;

grant execute on function public.bml_get_nearby_places(double precision, double precision, integer, text, integer) to anon, authenticated;
