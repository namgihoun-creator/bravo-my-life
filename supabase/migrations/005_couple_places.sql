-- 005: 커플 공유 코드(회원가입 없음) — 두 스마트폰 간 '찜'·'다녀옴(한 줄 메모)' 실시간 동기화
-- Supabase SQL Editor 에서 실행하세요. 여러 번 실행해도 안전합니다(idempotent).
--
-- ⚠ 보안 성격: 로그인이 없어 코드를 아는 사람은 누구나 그 코드의 행을 읽고 쓸 수 있습니다(공개 anon 키 + 코드 = 열쇠).
--   장소 id·찜 여부·60자 메모만 저장되며, 4자리 코드는 추측이 쉬우니 가능하면 앱의 '새 코드 자동 생성'(6자리)을 쓰세요.
--   삭제 권한은 주지 않습니다(해제는 is_favorite/is_visited = false 로 표현).

create table if not exists public.bml_couple_places (
  id           uuid primary key default gen_random_uuid(),
  couple_code  text not null check (couple_code ~ '^[A-Z0-9]{4,8}$'),   -- 대문자·공백 제거 정규화된 코드
  place_id     text not null check (char_length(place_id) between 1 and 64),
  is_favorite  boolean not null default false,
  is_visited   boolean not null default false,
  visited_note text check (visited_note is null or char_length(visited_note) <= 60),
  updated_at   timestamptz not null default now(),
  constraint bml_couple_places_code_place_key unique (couple_code, place_id)
);

create index if not exists bml_couple_places_code_idx on public.bml_couple_places (couple_code);

-- 코드 정규화(대문자·공백 제거) + 갱신 시각 + 키 컬럼 불변 보장
create or replace function public.bml_couple_places_guard()
returns trigger
language plpgsql
as $$
begin
  new.couple_code := upper(regexp_replace(coalesce(new.couple_code, ''), '\s', '', 'g'));
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.couple_code <> old.couple_code or new.place_id <> old.place_id) then
    raise exception 'couple_code / place_id cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists bml_couple_places_guard on public.bml_couple_places;
create trigger bml_couple_places_guard
  before insert or update on public.bml_couple_places
  for each row execute function public.bml_couple_places_guard();

-- RLS: 익명(anon) 조회·저장·수정만 허용, 삭제는 없음
alter table public.bml_couple_places enable row level security;

drop policy if exists "bml_couple_select" on public.bml_couple_places;
create policy "bml_couple_select" on public.bml_couple_places for select using (true);

drop policy if exists "bml_couple_insert" on public.bml_couple_places;
create policy "bml_couple_insert" on public.bml_couple_places for insert
  with check (couple_code ~ '^[A-Z0-9]{4,8}$');

drop policy if exists "bml_couple_update" on public.bml_couple_places;
create policy "bml_couple_update" on public.bml_couple_places for update
  using (true) with check (couple_code ~ '^[A-Z0-9]{4,8}$');

grant select, insert, update on table public.bml_couple_places to anon, authenticated;

-- 두 기기 실시간 동기화: Realtime(postgres_changes)로 내보낸다 (이미 등록돼 있으면 무시)
do $$
begin
  alter publication supabase_realtime add table public.bml_couple_places;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
