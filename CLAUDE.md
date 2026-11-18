# Project: Bravo My Life (bravo-my-life)
- **Sub-copy:** 내 손안의 동네 생존 & 찐노포 가이드

## 1. Core Concept & UX Principles
- **Target:** 길 위에서 급하게 생활 편의시설을 찾거나, 광고 없는 진짜 로컬 노포를 찾는 1인 가구 및 직장인.
- **Mobile-First:** 모든 UI는 모바일 뷰포트(`max-w-md` 중앙 정렬, 768px 이상 폴드 펼침 화면은 `max-w-2xl`) 기준으로 설계하고, 갤럭시 Z 폴드 커버 화면(320~344px)에서도 가로 스크롤·잘림이 없어야 한다(DESIGN.md §18).
- **Zero-Friction:** 회원가입, 로그인, 복잡한 팝업을 절대 만들지 않는다. 접속 즉시 GPS 기반으로 가장 가까운 장소를 보여준다.
- **Dual Mode:** 상단 전환 탭을 통해 두 가지 모드를 명확히 분리한다.
  1. `[긴급 생존 모드]`: 코인세탁소, 무인프린트, 심야약국, 보조배터리 등 즉각적인 문제 해결 시설
  2. `[찐노포 탐색 모드]`: 인허가 기준 업력 10년 이상(+ 비광고 후기 교차 검증)으로 확인된 동네 찐맛집
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
- **필터 칩:** 현재 반경 내 0건인 카테고리 칩은 숨긴다. 단, 생존 모드 핵심 카테고리(`개방화장실`·`공영주차장`)는 0건이어도 칩을 보여 주고 선택하면 "반경 내 등록된 …이 없어요. 지도를 넓혀 다시 찾아보세요"를 띄운다.
- **조회:** 홈은 `bml_get_nearby_places`를 생존/노포 모드별로 따로 호출(각 limit 400)해 한쪽이 limit을 채워 다른 쪽이 잘리지 않게 한다. 화장실은 카카오 키워드(`개방화장실`·`공중화장실`·`공공화장실`·`지하철역 화장실`·`공원 화장실`·`개방화장실 무료`)로 수집한다.
- **장소 제보:** 헤더가 아닌 목록 하단/빈 상태의 `+ 장소 제보` 버튼 → 바텀시트 폼 → `POST /api/places/report`. 서버 라우트만 `SUPABASE_SERVICE_ROLE_KEY`로 insert하며(`source='user'`, 태그 `#유저제보`), 동일 출처 확인·허니팟·IP당 시간당 5건·링크/연락처 차단·100m 내 동명 중복 차단을 적용한다. 제보 행 일괄 삭제: `delete from bml_places where source='user'`.
- **피드백 중복 방어:** `src/lib/votes.ts`가 투표 상태를 localStorage로 잠근다(투표한 칩은 취소만 가능). 서버 RPC 자체는 익명 호출을 막지 못하므로 클라이언트 방어선임을 잊지 않는다.
- **공영주차장 요금:** 공공데이터에 요금이 없는 지자체는 임의 수치를 쓰지 않고 '요금 공개 정보 없음'으로 표기한다(`#지자체공영`). 요금 범위는 같은 지자체의 CSV 실데이터(3곳 이상)에서만 계산한다.
- **지도 뷰:** 필터 칩 우측의 `[목록 / 지도]` 토글(기본 목록). 카카오맵 JS SDK는 `NEXT_PUBLIC_KAKAO_JS_KEY`로 `src/lib/kakaoMaps.ts`에서만 로드하며, 키 누락·도메인 미등록·지연은 에러 패널(`다시 시도`/`목록으로 보기`)로 처리해 앱이 멈추지 않게 한다. 핀 색은 모드 토큰(생존=파랑, 노포=갈색/앰버)을 따르고, 핀 클릭 시 하단에 장소 카드, 지도 빈 곳 클릭/Esc로 닫는다. 카카오 개발자 콘솔 → 플랫폼 → Web에 배포 도메인 등록이 필요하다.
- **핀 클러스터링:** SDK를 `libraries=clusterer`로 로드하고 `MarkerClusterer`(레벨 4 이상에서 묶음, 클릭 시 확대)로 겹치는 핀을 숫자로 묶는다. 클러스터·핀 색은 모드 톤(파랑/갈색) 상수를 쓰며, 선택된 핀은 클러스터 밖의 앰버 오버레이로 표시한다.
- **거주자우선주차장 영구 제외:** 이름에 `거주자`가 들어간 주차장은 `collect_data.py`/`enrich_data.py`에서 수집·매칭하지 않는다(일반 이용 불가).
- **노포 노출 기준:** 찐노포 모드는 인허가 연도로 업력 10년 이상이 검증된 가게와 `#유저제보`만 보여준다(미확정 '노포 후보'는 DB에는 있어도 화면에서 숨김). 업력은 `open_year`(없으면 `업력 N년` 뱃지)로 올해 기준 계산하고, 뱃지는 10/15/20/30년 4단계 색(DESIGN.md §6-1), 필터 칩은 `전체/10년+/15년+/20년+/30년+`.
- **지금 영업 중 필터:** `src/lib/openStatus.ts`가 Asia/Seoul 기준으로 판별한다. `24시간/24시/연중무휴`(구간 표기와 '24시 운영 여부' 확인 문구는 제외) 또는 `HH:MM~HH:MM`·`9~18시` 구간이 명시된 장소만 true/false, 정보가 없으면 null(=모름)이며 허위로 영업 중이라 표시하지 않는다. 필터를 켜면 null은 제외하고 "영업시간 미확인 장소 N곳 제외됨"을 안내한다. 평일 전용 시간은 주말에 null.
- **오프라인 복원력:** 최근 조회 결과를 `localStorage`(`bml_nearby_cache_v1`, 최대 4곳·3km 이내)에 캐시하고, 오프라인/10초 타임아웃/조회 실패 시 에러 대신 캐시와 안내 배너를 보여준다(캐시도 없으면 에러+다시 시도). `public/sw.js`는 앱 셸·아이콘·매니페스트·`/_next/static`·Pretendard만 캐시하며 `/api/*`와 Supabase·카카오 응답은 캐시하지 않는다. 캐시 구조를 바꾸면 `sw.js`의 `VERSION`을 올린다.
- **멀티 길찾기:** 카드의 길찾기 버튼은 분할 버튼(`NavigationButton`)이다. 앱은 카카오맵/네이버지도/티맵(`src/lib/navigation.ts`, `localStorage bml_nav_app`, 기본 카카오)이며 한 곳에서 바꾸면 모든 카드가 즉시 바뀐다. 네이버는 모바일에서 앱 스킴(`nmap://route/{car|walk}`, 출발지 자동)을 먼저 호출하고 1.5초 안에 전환이 없으면 출발지(현재 기준 위치)를 채운 웹 경로(`/p/directions`)로 이동, 데스크톱은 곧바로 웹 경로로 연다(공영주차장=car, 그 외=walk). URL 생성은 `src/lib/navUrls.ts`(순수 함수). 티맵은 `tmap://` 스킴 호출 후 1.5초 안에 화면 이탈이 없으면 안내 토스트(`src/lib/toast.ts`)를 띄운다. 버튼 높이 48px, ▾ 시트는 '선택만 바꾸기'와 '바로 안내'를 모두 제공한다.
- **노포 업종·중복 문구:** `python scripts/enrich_data.py --classify`가 검증 노포를 위생업태명+상호 키워드로 분류해 `extra`의 `food:한식 · 고기·구이`, 업종 태그(맨 앞), 요약(`2011년 개업 · 한식(고기·구이) 전문점이에요.`)을 갱신한다(`#업력N년`·`#노포`·"N년째 영업 중" 금지: 업력 뱃지와 중복). `--pass2`/기본 실행 끝에서도 자동 호출된다.
- **찜·공유:** 찜은 `localStorage bml_favorites`(장소 스냅샷, 오프라인 가능, `src/lib/favorites.ts`), 공유는 `src/lib/share.ts`(`navigator.share` → 클립보드 폴백, 취소는 무시).
- **현장 팁(`bml_add_place_tip`):** 정기휴무·영업시간·브레이크타임·한 줄 팁은 `feedback` JSONB에 병합 저장한다(`closed_days`/`hours`/`break_time`/`tips`; 이 키는 칩 카운트 RPC가 건드릴 수 없게 예약). `src/lib/openStatus.ts`는 현장 정보를 요약 추정보다 우선해 판별한다. 두 기기 공유는 Realtime(`UPDATE`) + 30초 이상 비활성 후 복귀 시 조용한 새로고침. `supabase/migrations/004_field_tips.sql`을 SQL Editor에서 실행해야 동작한다.
- **지도 재조회:** 지도 뷰에서 드래그 또는 줌으로 지도 중심이 조회 기준에서 200m 이상 벗어나면 `이 지역에서 다시 검색` 버튼(44px, 상단 중앙, 그림자)을 띄우고, 누르면 `map.getCenter()` 기준으로 다시 조회한다(`PlaceMap.onSearchHere` → Home `searchHere`, 위치 표시는 `지도 현위치`, 노포 기준점 해제). 코드가 지도를 움직인 직후 900ms의 `zoom_changed`는 사용자 조작으로 보지 않는다. 오프라인이면 조회하지 않고 토스트만 띄운다. 카카오 지도는 콘솔에 등록된 도메인(개발은 `localhost:3000`)에서만 로드되므로 지도 검증은 3000 포트로 한다.
- **거점 36곳:** `scripts/collect_data.py`의 `HUBS`(수도권 구도심·생활권 포함)와 `src/data/places.ts`의 `HUBS`를 같이 늘린다. 새 거점 수집 후 순서: `collect_data.py --hubs …` → `enrich_nopo.py --stage1-only` → `enrich_data.py`(주차장 요금·노포 1차·업종 분류) → `enrich_data.py --pass2`.
- **주차장 요금(`fee:`):** `enrich_data.py`가 공공데이터 주차장 CSV에서 요금 체계와 특기사항의 무료 개방 정보를 파싱해 `extra`의 `fee:` 항목과 `summary`에 넣는다(`fee:최초 30분 600원 · 10분당 300원`, `fee:일요일·공휴일 무료`). 데이터가 없으면 만들지 않는다.
- **필터 칩 단일 선택:** `전체/찜/지금 영업 중/카테고리·연차` 칩은 항상 1개만 활성이다(`aria-pressed`). `지금 영업 중`을 켜면 카테고리는 `전체`로 돌아가고 활성 표시는 영업 중 칩만, 다른 칩을 고르면 영업 중은 꺼진다. 찜은 0건이어도 활성으로 남고 빈 안내를 보여 `전체`와 겹쳐 보이지 않는다. 칩에는 `hover` 스타일을 두지 않고(터치 잔상 방지) 활성/비활성은 배경·테두리·글자색으로만 구분한다.
- **카테고리 우선순위·재수집 보호:** `collect_data.py`의 적재는 insert-only(이미 있는 행은 건너뜀)라 `enrich_*.py`가 채운 요금(`fee:`)·요약·업력을 재수집이 덮어쓰지 못한다. 상호에 `화장실`이 있으면 화장실이다(`○○공영주차장 개방화장실`은 주차장이 아님 → 주차장 수집에서 제외). 화장실 검색에서 PK6/상호에 `주차`만 있고 `화장실`이 없는 장소는 toilet이 되지 못한다.
- **화장실 밀집 수집:** `python scripts/collect_data.py --categories none --dense-toilets`는 거점 중심+6방향 보조 중심(반경 1km)에서 `공중화장실`·`개방화장실`·`공공화장실`·`공원 화장실`·`지하철역 화장실`을 검색한다. 개방시간 공공데이터(공중화장실 표준데이터 CSV/OpenAPI)는 아직 없어 개방시간은 `#이용시간확인`으로 둔다(허위 표시 금지).
- **PWA 이름:** 앱 이름·`short_name`·iOS 홈 화면 제목은 모두 `브라보 마이 라이프`. 아이콘은 불투명 180px(`apple-touch-icon`), 192/512(any), 512 maskable.
- **공중화장실 CSV(`scripts/enrich_toilets.py`):** `data/raw/공중화장실정보.csv`(cp949, 좌표 없음)에서 허브 인근 시군구 행만 카카오 주소 검색으로 지오코딩(캐시 `scripts/out/toilet_geocode.json`, 8,769건에 약 40분)한다. 기존 toilet 행과 40m 이내(또는 80m+상호 유사)면 `extra`의 `hours:`(`24시간`/`09:00~18:00`/`평일 09:00~18:00`)·`facility:`(장애인화장실·기저귀교환대·비상벨)와 요약·태그를 갱신하고, 없으면 허브 2km 안에서 신규 적재(`kakao_id='pub-toilet:{관리번호}'`, insert-only). 미개방·이동/간이 화장실 제외, 개방시간이 모호하면 만들지 않는다. `openStatus.ts`는 요약·extra의 `24시`와 `HH:MM~HH:MM`(`평일` 접두 포함)을 그대로 읽는다.
- **세차장(`category='carwash'`, `scripts/enrich_carwash.py`):** `data/raw/세차장정보.csv`에서 허브 2km 안만 insert-only 적재(`pub-carwash:{관리번호}`). `extra`는 `type:셀프세차|손세차|자동세차|세차장`, `hours:`, `closed:`; 매주 같은 요일 휴무는 `feedback.closed_days`로 넣어 '오늘 정기휴무'를 판별한다. `연중무휴`는 24시간으로 오인되므로 요약·태그에 쓰지 않는다. 길찾기는 주차장과 같이 자동차(`car`), 생존 모드 핵심 칩(0건이어도 노출)이며 제보 카테고리 화이트리스트(`report/route.ts`)에도 포함한다.
- **PWA 검증 메모:** 서비스 워커는 프로덕션 빌드(`npm run start`)에서만 등록된다(개발 서버에서는 `ready`가 null). `manifest.json`·`sw.js`는 `Cache-Control: no-cache`.
- **앱 설치 UI:** `src/lib/install.ts`(스토어)·`src/components/InstallApp.tsx`(최상단 슬림 바로가기 추가 바 `InstallBar`(문구 `홈 화면에 바로가기 추가`, 우측 `닫기`(텍스트) + `추가`(알약)) + 안내 시트). standalone(`display-mode: standalone` 또는 `navigator.standalone`)·설치 완료·이번 세션 `닫기`(sessionStorage `bml_install_bar_closed`)면 바를 그리지 않는다. `beforeinstallprompt`는 layout `<head>` 인라인 스크립트가 `window.__bip`에 먼저 담고(hydrate 전 발생 대비) 스토어가 이어받아, 바의 `추가`가 `prompt()`를 호출하고 이벤트가 없으면(아이폰 Safari·재설치 대기) 안드로이드/아이폰 2단계 안내 시트를 연다. `appinstalled`는 토스트 + 바 숨김. 헤더 안에는 설치 버튼을 두지 않는다. 크롬 설치 조건: manifest 아이콘 `any`/`maskable` 분리 등록, `sw.js`에 `fetch` 핸들러.
- **카테고리 아이콘:** 필터 칩·카드 배지는 `src/components/CategoryIcon.tsx`의 단일 매핑(lucide 14px, `strokeWidth` 2, `currentColor`, `gap-1.5`)만 쓴다. 필터 라벨에 이모지를 넣지 않으며, 새 카테고리는 매핑에 아이콘을 먼저 등록한다(DESIGN.md §19).
- **주변 주차장(노포→주차장):** 노포 카드의 `주변 주차장`은 `Home`의 `anchor`(가게 id·이름·좌표·직전 필터)를 세팅해 생존 모드·공영주차장으로 전환하고, `useAnchorParking`이 `bml_get_nearby_places`를 가게 좌표 반경 500m→(0건이면)800m, `p_mode='survival'`로 조회해 `parking`만 가게 기준 거리순으로 보여준다(`loc`/GPS 조회는 그대로 유지해 복귀가 즉시). 카드 거리는 `{가게명}에서 도보 N분`. 배너의 `노포로 돌아가기`·모드 탭·동네/GPS 변경은 anchor를 해제한다(DESIGN.md §20).
- **빠른 키워드 검색:** 헤더의 돋보기(44×44)가 검색 바(입력 44px, 지우기 X, 닫기)를 연다. `matchesQuery`(places.ts)가 상호·요약·태그·extra(세차유형·편의시설·업종)·주소에서 대소문자·공백 무시, 공백 단어 AND로 부분 일치하고, 현재 모드·선택 칩과 함께 적용된다(목록·지도 공통). 닫기는 검색어를 지우고 접으며, 돋보기만 다시 누르면 검색어를 유지한 채 접고 파란 점으로 표시한다. 0건이면 `‘○○’에 맞는 장소가 없어요` + `검색어 지우기`.
- **노포 업종 칩·페이지네이션:** 업종 칩은 `FOOD_CHIPS`(places.ts, `fd:` key)를 `extra`의 `food:` 라벨로 판별하며 0건이면 숨긴다. 칩은 단일 선택이고 활성 칩 재클릭 시 `전체`로 복귀한다. 목록은 `PAGE_SIZE`(30)만 그리고 `더 보기 (남은 N곳)`로 30곳씩 늘리며, 조회 조건(`listKey`)이 바뀌면 30곳으로 초기화한다. 지도·건수는 전체 기준(DESIGN.md §22). 지도 검증은 `localhost:3000`에서만 가능하다.
- **커플 코드 동기화(`bml_couple_places`, `supabase/migrations/005_couple_places.sql`):** 회원가입 없이 4~8자리 코드로 두 폰의 찜·다녀옴(60자 메모)을 맞춘다(`src/lib/couple.ts`·`visited.ts`·`favorites.ts`, UI `CoupleSheet`). 코드가 없으면 localStorage(`bml_favorites`·`bml_visited`)만 쓴다. 첫 연결은 합집합 병합(기기 전용 찜·다녀옴이 서버로 올라가고, 서버 것은 기기로 내려온다). 이후 변경은 `bml_couple_places`에 upsert하고 Realtime(`postgres_changes`)·앱 복귀·온라인 복귀 때 재동기화한다. 서버로 보내는 변경과 받은 변경은 **각각 순서대로 한 줄 큐**로 처리한다(체크인 직후 메모 저장이 서로 덮어쓰는 경쟁 상태 방지). 실패한 전송은 `bml_couple_pending`에 쌓았다가 다음 동기화 때 먼저 보낸다. 상대 기기에 없는 장소는 `bml_places`에서 id로 불러온다. RLS는 anon 조회·삽입·수정만 열고 삭제는 없다(해제는 `is_favorite`/`is_visited=false`). ⚠ 로그인이 없어 코드를 아는 사람은 누구나 그 코드의 데이터를 읽고 쓸 수 있으니 자동 생성 6자리를 권장한다. 이 테이블 DDL은 SQL Editor에서만 적용된다.
- **다녀옴 필터:** 이 모드에서 다녀옴이 1곳 이상일 때만 `다녀옴` 칩이 보이고 목록은 거리순이다(DESIGN.md §23).
- **데이터 현행화 체계(`supabase/migrations/006_data_freshness.sql`):** `bml_places` 행은 **절대 DELETE 하지 않는다**(커플 찜·다녀옴 `bml_couple_places.place_id`, 현장 제보·피드백이 `id`를 참조). 폐업·미검출은 `is_active=false`(소프트 삭제)로만 숨기고 조회 RPC `bml_get_nearby_places`는 `is_active`만 반환한다. 컬럼: `source_key`(unique nullable, `kakao_<id>`·`pub_toilet_…`), `is_active`, `last_synced_at`(백필은 `created_at`), `closure_reports`, `reported_issue`(`'closed'|'info_changed'`). anon 은 테이블을 수정할 수 없고 `report_place_issue(p_place_id, p_issue_type)`(security definer)로만 제보를 누적한다. 프론트는 006 전에도 동작한다(RPC 응답에 새 필드가 없으면 기준일·경고 배지를 숨기고, 제보 RPC 실패는 안내만 한다).
- **현행화 스크립트(`scripts/sync-places.ts`, Node 24 타입 제거 실행):** `npm run sync:survival` / `npm run sync:nopo-check` (+ `-- --dry-run`, `--hubs=부천역,수원역`, `--limit=N`). `survival`은 36개 거점에서 카카오로 코인세탁·프린트·약국·셀프세차를 다시 조회해 `source_key` 기준으로 기존 행은 좌표·주소·(기본 문구일 때만)요약·`last_synced_at`만 UPDATE, 신규는 INSERT, 이번에 안 보인 카카오 출처 행은 '미검출'로 **세기만** 한다(키워드당 45건 한도라 자동으로 숨기지 않음). 다른 출처(공공데이터 세차장 등)와 40m·상호가 겹치면 새로 만들지 않는다. `nopo-check`는 검증된 노포를 상호+반경 150m로 대조해 안 보이면 삭제 대신 `reported_issue='closed'`(폐업 의심)만 걸고, 다시 보이면(제보 0건일 때) 플래그를 푼다. 006 적용 전에는 `--dry-run`만 가능하다.
- **GitHub Actions(`.github/workflows/sync-places.yml`):** 격주 일요일 04:00 KST(`survival`: 매주 토 19:00 UTC에 깨워 ISO 홀수 주는 건너뜀), 분기 1일 04:30 KST(`nopo-check`: 12/31·3/31·6/30·9/30 19:30 UTC), 수동 실행(`workflow_dispatch`, mode·dry_run 선택, 처음엔 dry_run=true 권장). **Secrets**(저장소 Settings → Secrets and variables → Actions → New repository secret): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(서버 전용, 절대 `NEXT_PUBLIC_`로 노출 금지), `KAKAO_REST_API_KEY`. 저장소가 60일간 활동이 없으면 GitHub이 예약 실행을 멈추니 가끔 수동 실행하거나 커밋한다.
