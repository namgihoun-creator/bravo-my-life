-- 현장 팁 등록: 정기휴무일 · 영업시간 · 브레이크타임 · 한 줄 팁
-- 실행: Supabase SQL Editor (여러 번 실행해도 안전)
--
-- 로그인 없는 사용자가 테이블 수정 권한 없이, 이 함수를 통해서만 feedback(JSONB)의 현장 정보를 갱신한다.
--   feedback.closed_days : ["월","일"]            (최신값으로 덮어씀, [] 이면 휴무일 없음)
--   feedback.hours       : "11:00~21:30"          (최신값, '' 이면 삭제)
--   feedback.break_time  : "15:00~17:00"          (최신값, '' 이면 삭제)
--   feedback.tips        : [{"t":"…","at":"2026-…Z"}, …]  (최신순 최대 10개)
-- 파라미터가 null 이면 해당 항목은 그대로 둔다.

-- 'HH:MM~HH:MM' 정규화 (잘못된 값이면 예외, 빈 값이면 null)
create or replace function public.bml_norm_time_range(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  m  text[];
  h1 int;
  m1 int;
  h2 int;
  m2 int;
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  m := regexp_match(p_text, '^\s*(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})\s*$');
  if m is null then
    raise exception 'invalid time range' using errcode = '22023';
  end if;
  h1 := m[1]::int;
  m1 := m[2]::int;
  h2 := m[3]::int;
  m2 := m[4]::int;
  if h1 > 23 or m1 > 59 or h2 > 24 or m2 > 59 or (h2 = 24 and m2 <> 0) then
    raise exception 'invalid time range' using errcode = '22023';
  end if;
  return lpad(h1::text, 2, '0') || ':' || lpad(m1::text, 2, '0') || '~' ||
         lpad(h2::text, 2, '0') || ':' || lpad(m2::text, 2, '0');
end;
$$;

create or replace function public.bml_add_place_tip(
  p_place_id    uuid,
  p_closed_days text[] default null,
  p_hours       text   default null,
  p_break_time  text   default null,
  p_tip         text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fb    jsonb;
  v_days  text[];
  v_range text;
  v_tip   text;
  v_tips  jsonb;
begin
  select feedback into v_fb from public.bml_places where id = p_place_id for update;
  if not found then
    raise exception 'place not found' using errcode = 'P0002';
  end if;
  v_fb := coalesce(v_fb, '{}'::jsonb);

  -- 정기휴무일: 월~일만 허용, 중복 제거, 요일 순 정렬
  if p_closed_days is not null then
    select coalesce(array_agg(d order by array_position(array['월','화','수','목','금','토','일'], d)), '{}')
      into v_days
      from (
        select distinct d
          from unnest(p_closed_days) as d
         where d = any (array['월','화','수','목','금','토','일'])
      ) s;
    v_fb := v_fb || jsonb_build_object('closed_days', to_jsonb(v_days));
  end if;

  -- 영업시간
  if p_hours is not null then
    v_range := public.bml_norm_time_range(p_hours);
    if v_range is null then
      v_fb := v_fb - 'hours';
    else
      v_fb := v_fb || jsonb_build_object('hours', v_range);
    end if;
  end if;

  -- 브레이크타임
  if p_break_time is not null then
    v_range := public.bml_norm_time_range(p_break_time);
    if v_range is null then
      v_fb := v_fb - 'break_time';
    else
      v_fb := v_fb || jsonb_build_object('break_time', v_range);
    end if;
  end if;

  -- 한 줄 팁: 최대 80자, 링크·연락처 불가, 최신순 최대 10개
  v_tip := btrim(regexp_replace(coalesce(p_tip, ''), '[[:cntrl:]]+', ' ', 'g'));
  if v_tip <> '' then
    if char_length(v_tip) > 80 then
      raise exception 'tip too long' using errcode = '22001';
    end if;
    if v_tip ~* '(https?:|www\.|[a-z0-9-]+\.(com|net|kr|io|me|co)([^a-z]|$)|@)' then
      raise exception 'links and contacts are not allowed' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
      into v_tips
      from (
        select e, ord
          from jsonb_array_elements(
                 jsonb_build_array(
                   jsonb_build_object(
                     't', v_tip,
                     'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                   )
                 )
                 || case when jsonb_typeof(v_fb -> 'tips') = 'array' then v_fb -> 'tips' else '[]'::jsonb end
               ) with ordinality as t(e, ord)
      ) s
     where ord <= 10;

    v_fb := v_fb || jsonb_build_object('tips', v_tips);
  end if;

  update public.bml_places set feedback = v_fb where id = p_place_id;
  return v_fb;
end;
$$;

grant execute on function public.bml_add_place_tip(uuid, text[], text, text, text) to anon, authenticated;

-- 현장 정보 키를 현장 피드백 칩(bml_update_feedback)이 덮어쓰지 못하게 예약한다
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
  if p_key !~ '^[a-z_]{1,20}$' or p_key in ('closed_days', 'hours', 'break_time', 'tips') then
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

grant execute on function public.bml_update_feedback(uuid, text, integer) to anon, authenticated;

-- 두 기기 실시간 공유: bml_places 변경을 Realtime 으로 내보낸다 (이미 등록돼 있으면 무시)
do $$
begin
  alter publication supabase_realtime add table public.bml_places;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
