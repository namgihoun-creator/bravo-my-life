-- 006: 데이터 현행화 체계 — 소프트 삭제(is_active), 출처 고유키(source_key), 최종 확인 시각, 폐업·정보오류 제보
-- Supabase SQL Editor 에서 실행하세요 (여러 번 실행해도 안전: idempotent).
--
-- 원칙: 장소 행은 절대 DELETE 하지 않는다. 커플 찜·다녀옴(bml_couple_places.place_id), 현장 제보·피드백이
--       bml_places.id 를 참조하므로 폐업·미검출은 is_active=false(소프트 삭제)로만 숨긴다.
-- 프론트는 이 마이그레이션 전에도 동작한다(새 컬럼이 없으면 기준일·경고 배지·제보 버튼만 비활성).

-- 1) 컬럼 추가 ---------------------------------------------------------------
alter table public.bml_places
  add column if not exists source_key      text,                          -- 외부 출처 고유 ID (예: kakao_12345678, pub_toilet_2025…)
  add column if not exists is_active       boolean not null default true, -- false = 소프트 삭제(폐업·미검출). 조회 RPC 에서 제외
  add column if not exists last_synced_at  timestamptz,                   -- 최종 데이터 현행화(확인) 시각
  add column if not exists closure_reports integer not null default 0,    -- 폐업·정보오류 제보 누적 건수
  add column if not exists reported_issue  text;                          -- 'closed' | 'info_changed' (제보 또는 폐업 의심 플래그)

-- last_synced_at 백필: 처음부터 now() 로 채우면 '방금 확인한 것'처럼 보이므로 수집 시각(created_at)으로 채운다
update public.bml_places set last_synced_at = coalesce(created_at, now()) where last_synced_at is null;
alter table public.bml_places alter column last_synced_at set default now();
alter table public.bml_places alter column last_synced_at set not null;

-- source_key 백필: 카카오 숫자 ID 는 kakao_<id>, 공공데이터(pub-toilet:…, pub-carwash:…)는 영숫자 외 문자를 _ 로
update public.bml_places
   set source_key = case
         when kakao_id ~ '^[0-9]+$' then 'kakao_' || kakao_id
         else regexp_replace(kakao_id, '[^A-Za-z0-9]+', '_', 'g')
       end
 where source_key is null and kakao_id is not null;

-- unique + nullable (NULL 은 여러 개 허용: 유저 제보 행은 키가 없다)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bml_places_source_key_key') then
    alter table public.bml_places add constraint bml_places_source_key_key unique (source_key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bml_places_reported_issue_check') then
    alter table public.bml_places
      add constraint bml_places_reported_issue_check check (reported_issue is null or reported_issue in ('closed', 'info_changed'));
  end if;
end;
$$;

-- 2) 조회 RPC: 활성 장소만, 기준일·제보 상태를 함께 반환 --------------------------------
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
  closure_reports integer
)
language sql
stable
as $$
  select
    p.id, p.mode, p.category, p.extra, p.name, p.address, p.place_url,
    p.badge, p.tags, p.summary, p.lat, p.lng, p.feedback, p.open_year,
    st_distance(p.geog, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) as distance_m,
    p.last_synced_at, p.reported_issue, p.closure_reports
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

-- 3) 폐업·정보오류 제보 RPC ----------------------------------------------------------
-- anon 은 테이블을 직접 수정할 수 없다(RLS: select 만). 이 함수만 security definer 로
-- closure_reports +1 과 reported_issue 갱신을 대신해 준다. 다른 컬럼은 건드리지 못한다.
create or replace function public.report_place_issue(p_place_id uuid, p_issue_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reports integer;
  v_issue   text;
begin
  if p_issue_type is null or p_issue_type not in ('closed', 'info_changed') then
    raise exception 'invalid issue type';
  end if;

  update public.bml_places
     set closure_reports = closure_reports + 1,
         -- 폐업 제보가 한 번이라도 있으면 'closed' 유지, 아니면 'info_changed'
         reported_issue  = case when p_issue_type = 'closed' or reported_issue = 'closed' then 'closed' else 'info_changed' end
   where id = p_place_id and is_active
  returning closure_reports, reported_issue into v_reports, v_issue;

  if not found then
    raise exception 'place not found';
  end if;
  return jsonb_build_object('closure_reports', v_reports, 'reported_issue', v_issue);
end;
$$;

revoke all on function public.report_place_issue(uuid, text) from public;
grant execute on function public.report_place_issue(uuid, text) to anon, authenticated;
