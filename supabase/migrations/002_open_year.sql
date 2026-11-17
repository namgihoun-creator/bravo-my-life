-- 노포 업력 검증용: 인허가 연도 (scripts/enrich_data.py 가 채움)
-- 실행: Supabase SQL Editor (여러 번 실행해도 안전)
alter table public.bml_places add column if not exists open_year integer;
