# Project: Bravo My Life (bravo-my-life)
- **Sub-copy:** 내 손안의 동네 생존 & 찐노포 가이드

## 1. Core Concept & UX Principles
- **Target:** 길 위에서 급하게 생활 편의시설을 찾거나, 광고 없는 진짜 로컬 노포를 찾는 1인 가구 및 직장인.
- **Mobile-First:** 모든 UI는 모바일 뷰포트(최대 너비 480px, `max-w-md` 중앙 정렬) 기준으로 설계한다.
- **Zero-Friction:** 회원가입, 로그인, 복잡한 팝업을 절대 만들지 않는다. 접속 즉시 GPS 기반으로 가장 가까운 장소를 보여준다.
- **Dual Mode:** 상단 전환 탭을 통해 두 가지 모드를 명확히 분리한다.
  1. `[긴급 생존 모드]`: 코인세탁소, 무인프린트, 심야약국, 보조배터리 등 즉각적인 문제 해결 시설
  2. `[찐노포 탐색 모드]`: 업력 15년 이상 + 비광고 실방문 리뷰로 검증된 동네 찐맛집
- **공영주차장 (Parking):** `[긴급 생존 모드]` 하위 필터에 `🅿️ 공영주차장` 카테고리를 둔다.
  - 주차장 카드의 핵심 태그 3개는 **요금 + 주차 방식**으로 구성해 조수석 동승자가 3초 안에 판단할 수 있게 한다. (예: `#공영1급지` `#자주식넓음` `#10분당400원` / `#기계식주의`)
  - **모드 간 연결:** `[찐노포 탐색 모드]`의 카드에 `#주차불가` 태그가 있으면 카드 바로 아래에 `🅿️ 인근 공영주차장 보기 · 도보 N분` 서브 액션 버튼을 둔다. 누르면 긴급 생존 모드 → 공영주차장 필터로 전환되고 가장 가까운 주차장 카드로 스크롤·강조한다. 가장 가까운 주차장과 도보 시간은 좌표로 계산한다(하드코딩 금지).
  - 서브 액션 버튼도 터치 높이 44px 이상을 지킨다.
- **Design Rule:** UI 코드를 작성하기 전 반드시 루트의 `DESIGN.md` 디자인 시스템을 최우선으로 따른다.

## 2. Tech Stack
- **Framework:** Next.js (App Router), TypeScript, Tailwind CSS
- **Icons:** Lucide-react
- **Database:** Supabase (PostgreSQL + PostGIS)
- **External APIs:** Kakao Local API, Naver Search API, 공공데이터포털 (일반음식점 인허가)

## 3. Data & Card UI Rules
- 블로그 본문이나 타인의 사진은 저작권 및 가독성 저하를 막기 위해 직접 노출하지 않는다.
- 모든 장소 카드는 `[장소명 / 도보 거리(분) / 핵심 스펙 태그 3개 / AI 한 줄 요약 / 카카오맵 길찾기 버튼]` 구조로 컴팩트하게 렌더링한다.
- 한 손 조작을 위해 주요 버튼과 탭의 터치 영역 높이는 최소 44px 이상으로 구현한다.

## 4. Data Layer (Supabase + 수집 파이프라인)
- **스키마:** `supabase/schema.sql` (PostGIS, `bml_places`, RPC `bml_get_nearby_places` / `bml_update_feedback`). Supabase SQL Editor에서 실행한다.
- **프론트:** 브라우저에서는 publishable 키만 사용한다. `SUPABASE_SERVICE_ROLE_KEY`, `KAKAO_REST_API_KEY`는 서버/스크립트 전용이며 `NEXT_PUBLIC_` 접두사를 붙이지 않는다. 카카오 검색은 `/api/geocode` 라우트로만 호출한다.
- **수집:** `python scripts/collect_data.py [--dry-run] [--hubs 부천역 ...]`. 노포는 '1차 후보'이며 업력·실방문 검증 전에는 `#실방문검증전` 태그와 `노포 후보` 뱃지를 쓴다.
- `.env.local`은 커밋하지 않는다 (`.gitignore`의 `.env*`로 제외됨).
- **노포 정제:** `python scripts/enrich_nopo.py`가 프랜차이즈(같은 브랜드 3곳 이상)·카페/디저트를 삭제하고 카카오 블로그 검색으로 교차 검증한다. 삭제한 ID는 `scripts/data/nopo_excluded.json`에 기록되어 재수집 시 제외되고, 이미 있는 노포 행은 재수집이 덮어쓰지 않는다. 블로그 문장은 그대로 옮기지 않고 키워드만 집계해 요약한다(저작권 규칙).
- **필터 칩:** 현재 반경 내 0건인 카테고리 칩은 숨긴다.
- **장소 제보:** 헤더가 아닌 목록 하단/빈 상태의 `+ 장소 제보` 버튼 → 바텀시트 폼 → `POST /api/places/report`. 서버 라우트만 `SUPABASE_SERVICE_ROLE_KEY`로 insert하며(`source='user'`, 태그 `#유저제보`), 동일 출처 확인·허니팟·IP당 시간당 5건·링크/연락처 차단·100m 내 동명 중복 차단을 적용한다. 제보 행 일괄 삭제: `delete from bml_places where source='user'`.
- **피드백 중복 방어:** `src/lib/votes.ts`가 투표 상태를 localStorage로 잠근다(투표한 칩은 취소만 가능). 서버 RPC 자체는 익명 호출을 막지 못하므로 클라이언트 방어선임을 잊지 않는다.
- **공영주차장 요금:** 공공데이터에 요금이 없는 지자체는 임의 수치를 쓰지 않고 '요금 공개 정보 없음'으로 표기한다(`#지자체공영`). 요금 범위는 같은 지자체의 CSV 실데이터(3곳 이상)에서만 계산한다.
- **지도 뷰:** 필터 칩 우측의 `[목록 / 지도]` 토글(기본 목록). 카카오맵 JS SDK는 `NEXT_PUBLIC_KAKAO_JS_KEY`로 `src/lib/kakaoMaps.ts`에서만 로드하며, 키 누락·도메인 미등록·지연은 에러 패널(`다시 시도`/`목록으로 보기`)로 처리해 앱이 멈추지 않게 한다. 핀 색은 모드 토큰(생존=파랑, 노포=갈색/앰버)을 따르고, 핀 클릭 시 하단에 장소 카드, 지도 빈 곳 클릭/Esc로 닫는다. 카카오 개발자 콘솔 → 플랫폼 → Web에 배포 도메인 등록이 필요하다.
