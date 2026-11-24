-- 008: '앱 의견 보내기' — 테스트 사용자의 한 줄 의견(좋아요/불편해요/아이디어) 수집
-- Supabase SQL Editor 에서 실행하세요 (여러 번 실행해도 안전: idempotent).
--
-- 개인정보 최소화: 이름·연락처·IP·기기 정보를 저장하지 않는다. 의견 본문(140자 이내, 링크·연락처는 서버가 차단)과
--   유형, 보낸 화면(모드 survival|nopo, 경로)만 저장한다.
-- 접근: RLS 를 켜고 정책을 만들지 않으므로 anon/authenticated 는 읽기·쓰기 모두 불가.
--       서버 라우트(POST /api/feedback)만 service role 키로 insert 한다. 확인은 SQL Editor 에서만 한다.
-- 조회 예:
--   select created_at, kind, mode, path, message from public.bml_app_feedback order by created_at desc;
--   select kind, count(*) from public.bml_app_feedback group by kind;

create table if not exists public.bml_app_feedback (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                          -- like | pain | idea
  message     text not null,                          -- 한 줄 의견
  mode        text,                                   -- 보낸 시점 모드(survival | nopo)
  path        text,                                   -- 보낸 화면 경로(예: '/', '/place')
  created_at  timestamptz not null default now(),
  constraint bml_app_feedback_kind_chk check (kind in ('like', 'pain', 'idea')),
  constraint bml_app_feedback_message_len check (char_length(message) between 2 and 140),
  constraint bml_app_feedback_mode_chk check (mode is null or mode in ('survival', 'nopo')),
  constraint bml_app_feedback_path_len check (path is null or char_length(path) <= 80)
);

create index if not exists bml_app_feedback_created_idx on public.bml_app_feedback (created_at desc);

alter table public.bml_app_feedback enable row level security;

-- 정책을 만들지 않는다(= anon 차단). 혹시 기본 권한이 열려 있어도 명시적으로 회수한다.
revoke all on table public.bml_app_feedback from anon, authenticated;
