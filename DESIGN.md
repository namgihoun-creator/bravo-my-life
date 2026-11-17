# DESIGN.md — Bravo My Life 모바일 디자인 시스템

> 내 손안의 동네 생존 & 찐노포 가이드
> UI 코드 작성 전 반드시 이 문서를 먼저 따른다. 모든 색상·간격·그림자는 raw 값이 아닌 **토큰**으로 사용한다.

## 1. 디자인 원칙

| 원칙 | 규칙 |
|---|---|
| Mobile-First | 컨테이너 `max-w-md`(480px) 중앙 정렬, 기준 뷰포트 375px. 가로 스크롤 금지 |
| Glanceable | 길 위에서 1초 안에 "어디, 몇 분"이 읽혀야 한다. 거리/도보 시간이 카드에서 가장 눈에 띄는 숫자 |
| Zero-Friction | 로그인·모달·팝업 없음. 상태 안내는 인라인 배너/스켈레톤으로 처리 |
| One-Hand | 주요 액션은 화면 하단 엄지 영역. 터치 영역 **최소 44px** (카드 CTA는 48px 권장), 인접 터치 요소 간격 8px 이상 |
| Dual Mode | 모드별로 팔레트·분위기가 확실히 달라야 한다. 모드는 `data-mode="survival" | "nopo"` 속성으로 CSS 변수를 교체한다 |

- 아이콘은 Lucide-react만 사용 (이모지를 아이콘 대용으로 쓰지 않는다). 아이콘 단독 버튼에는 `aria-label` 필수.
- 색상만으로 정보를 전달하지 않는다 (영업 상태는 색 + 텍스트 라벨).

## 2. 모드 전환 탭 (Dual Mode Switch)

- 화면 최상단 sticky, 높이 **56px**, 2분할 세그먼트(각 탭 `min-h-[44px]`, 전체 폭 50%).
- 활성 탭: 해당 모드의 `--primary` 배경 + `--on-primary` 텍스트. 비활성: 투명 + `--text-muted`.
- 탭 전환 시 페이지 배경/카드 액센트/CTA 색이 함께 교체된다 (전환 200ms, `prefers-reduced-motion` 시 즉시).
- 라벨: `긴급 생존` (아이콘 `Siren`) / `찐노포` (아이콘 `Store`).

## 3. 컬러 팔레트

### 3-1. 긴급 생존 모드 — "Utility" (`data-mode="survival"`)
시인성 최우선. 차갑고 선명한 유틸리티 톤, 높은 대비.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--primary` | `#0B5FFF` | 탭 활성, 링크, 아이콘 강조 (대비 on-white 5.6:1) |
| `--on-primary` | `#FFFFFF` | primary 위 텍스트 |
| `--accent` | `#FFD60A` | 영업중/긴급 하이라이트 배지 배경 |
| `--on-accent` | `#111827` | accent 위 텍스트 |
| `--cta` | `#D93A0F` | 카카오맵 길찾기 버튼 (대비 white 4.6:1) |
| `--on-cta` | `#FFFFFF` | |
| `--bg` | `#F3F6FB` | 페이지 배경 |
| `--surface` | `#FFFFFF` | 카드 배경 |
| `--text` | `#0F172A` | 본문 (대비 16:1) |
| `--text-muted` | `#475569` | 보조 텍스트 (대비 7.5:1) |
| `--border` | `#D5DDEA` | 카드/구분선 |
| `--tag-bg` / `--tag-text` | `#E6EEFF` / `#0847C4` | 스펙 태그 |

### 3-2. 찐노포 탐색 모드 — "Local Magazine" (`data-mode="nopo"`)
따뜻하고 신뢰감 있는 종이/잡지 톤. 오래된 가게의 깊이를 표현.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--primary` | `#8A3B12` | 탭 활성, 강조 (대비 on-cream 7.4:1) — 짙은 적갈색 |
| `--on-primary` | `#FFF8EC` | |
| `--accent` | `#C8963E` | 업력 배지/인장(도장) 포인트 (골드) |
| `--on-accent` | `#2B1A0E` | |
| `--cta` | `#2F5D50` | 카카오맵 길찾기 버튼 (신뢰감 있는 딥그린, 대비 7.6:1) |
| `--on-cta` | `#FFFFFF` | |
| `--bg` | `#FAF4E8` | 페이지 배경 (크림 페이퍼) |
| `--surface` | `#FFFDF7` | 카드 배경 |
| `--text` | `#2B1A0E` | 본문 (대비 14:1) |
| `--text-muted` | `#6B5744` | 보조 텍스트 (대비 6.2:1) |
| `--border` | `#E6D9C0` | 카드/구분선 |
| `--tag-bg` / `--tag-text` | `#F5E7CC` | `#6E3410` | 스펙 태그 |

### 3-3. 공통 시맨틱 (모드 무관)
| 토큰 | 값 | 용도 |
|---|---|---|
| `--success` | `#15803D` | 영업중 (텍스트 라벨 병기) |
| `--warning` | `#B45309` | 곧 마감 |
| `--danger` | `#B91C1C` | 영업종료/오류 |
| `--focus-ring` | `#0B5FFF` (노포 모드 `#8A3B12`) | 2px 포커스 링, 제거 금지 |

### Tailwind 연결 예시
```css
:root[data-mode="survival"] { --primary:#0B5FFF; --on-primary:#fff; --accent:#FFD60A; --on-accent:#111827;
  --cta:#D93A0F; --on-cta:#fff; --bg:#F3F6FB; --surface:#fff; --text:#0F172A; --text-muted:#475569;
  --border:#D5DDEA; --tag-bg:#E6EEFF; --tag-text:#0847C4; }
:root[data-mode="nopo"] { --primary:#8A3B12; --on-primary:#FFF8EC; --accent:#C8963E; --on-accent:#2B1A0E;
  --cta:#2F5D50; --on-cta:#fff; --bg:#FAF4E8; --surface:#FFFDF7; --text:#2B1A0E; --text-muted:#6B5744;
  --border:#E6D9C0; --tag-bg:#F5E7CC; --tag-text:#6E3410; }
```
`tailwind.config`의 `colors`에 `primary: 'var(--primary)'` 형태로 매핑하고 컴포넌트에서 raw hex를 쓰지 않는다.

## 4. 타이포그래피 (Pretendard)

- 폰트: **Pretendard Variable** (CDN: `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css`, `font-display: swap`).
- 스택: `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`
- 숫자(거리·시간·업력)는 `font-variant-numeric: tabular-nums`.
- 한글 본문 `word-break: keep-all; overflow-wrap: break-word;` 로 어절 단위 줄바꿈.
- 노포 모드 한정: 업력/섹션 타이틀에 `font-weight: 800` + `letter-spacing: -0.03em`로 잡지 헤드라인 느낌을 낸다 (별도 세리프 폰트는 쓰지 않는다).

| 역할 | 크기 / 행간 | 굵기 | 자간 | 용도 |
|---|---|---|---|---|
| Display | 28px / 36px | 800 | -0.03em | 온보딩/빈 상태 타이틀 |
| Title-1 | 22px / 30px | 700 | -0.02em | 섹션 제목 |
| Title-2 (장소명) | 18px / 26px | 700 | -0.02em | 카드 장소명 |
| Distance (도보) | 20px / 24px | 800 | -0.02em | `도보 5분` — 카드 최강조 숫자 |
| Body | 15px / 24px | 400 | -0.01em | AI 한 줄 요약 |
| Label | 14px / 20px | 600 | -0.01em | 버튼, 탭 |
| Caption | 12px / 16px | 500 | 0 | 태그, 영업 상태 (최소 12px) |

본문 최소 15px, 가독성을 위해 12px 미만 사용 금지.

## 5. 간격 & 레이아웃

- 4px 베이스 그리드. 스케일: `4 / 8 / 12 / 16 / 20 / 24 / 32 / 48`.
- 페이지 좌우 패딩 **16px**. 컨테이너 `mx-auto w-full max-w-md min-h-dvh`.
- 카드 간 세로 간격 **12px**, 섹션 간 **24px**.
- 카드 내부 패딩 **16px**, 카드 내부 요소 간격 **8px**(밀접) / **12px**(블록 간).
- 카드 라운드 `16px`, 버튼 `12px`, 태그 `999px`(pill), 탭 컨테이너 `14px`.
- 하단 safe-area: 하단 고정 요소에 `padding-bottom: max(12px, env(safe-area-inset-bottom))`.
- 상단 모드 탭 sticky 높이 56px — 스크롤 콘텐츠는 `scroll-padding-top: 64px`.

## 6. 그림자 & 보더

과한 그림자를 쓰지 않는다. 카드는 **보더 + 아주 옅은 그림자**로 구분한다.

| 토큰 | 값 | 사용처 |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(15,23,42,.06), 0 2px 8px rgba(15,23,42,.06)` | 기본 카드 |
| `--shadow-card-pressed` | `0 1px 2px rgba(15,23,42,.08)` | 카드 눌림 상태(+`scale(0.98)`) |
| `--shadow-sticky` | `0 2px 12px rgba(15,23,42,.10)` | sticky 모드 탭/하단 바 |
| 노포 모드 그림자 색 | `rgba(43,26,14,*)` 로 교체 | 따뜻한 그림자 |

- 카드 보더: `1px solid var(--border)`.
- 생존 모드 카드는 좌측 4px `--primary` 세로 바(긴급성 시그널), 노포 모드 카드는 우상단 `--accent` 업력 인장 배지로 구분.

### 6-1. 노포 업력 4단계 뱃지 (찐노포 모드 카드 우측 상단)
인허가 연도로 검증된 업력(올해 기준 N년)에 따라 뱃지 색을 달리한다. 텍스트는 `업력 N년`.

| 구간 | 배경 | 텍스트 | 테두리 | 대비 |
|---|---|---|---|---|
| 10~14년 | `#EFE2D3` | `#6B3A18` | `#DEC7AE` | 7.4:1 |
| 15~19년 | `#EBB138` | `#381E04` | 없음 | 8.0:1 |
| 20~29년 | `#8C2D19` | `#FFF8EE` | 없음 | 8.0:1 |
| 30년+ | `#241F1C` | `#F7C948` | `#C99A2E` | 10.4:1 |

- 구현은 `globals.css`의 `.age-badge-1~4` 클래스. 노포 모드 필터 칩은 `전체 / 10년+ / 15년+ / 20년+ / 30년+`.
- 노포 모드는 업력 10년 이상으로 검증된 가게와 `#유저제보`만 기본 노출한다(연식 미확정 '노포 후보'는 숨김). 유저 제보 뱃지는 기본 액센트색을 쓴다.

## 7. 장소 카드 (Place Card)

구조 고정 (CLAUDE.md 규칙): **장소명 / 도보 거리(분) / 핵심 스펙 태그 3개 / AI 한 줄 요약 / 카카오맵 길찾기 버튼**. 블로그 본문·타인 사진은 노출하지 않는다 (이미지 영역 없음).

```
┌──────────────────────────────────────────┐
│ 장소명 (Title-2)              도보 5분 ▸ │  ← 한 줄. 도보 시간은 --primary, Distance 스타일
│ 320m · 영업중 · 02:00까지   (Caption)    │
│ [태그1] [태그2] [태그3]                  │  ← pill 3개 고정, 줄바꿈 없음(truncate)
│ AI 한 줄 요약 (Body, 최대 2줄 clamp)     │
│ ┌────────────────────────────────────┐ │
│ │ 🧭 카카오맵 길찾기  (h-12, 풀폭)    │ │  ← --cta 배경, 48px
│ └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- 카드 전체 패딩 16px, 라운드 16px, `--surface` + `--shadow-card` + 보더.
- 태그: 높이 28px(시각) — 표시 전용이므로 터치 대상 아님. 상호작용 태그로 쓸 경우 터치 영역을 44px로 확장.
- 노포 모드 카드: 태그 중 하나는 반드시 `업력 N년`(accent 배경), 요약 앞에 `비광고 실방문 N건` 근거 문구 허용.
- 길찾기 버튼: Lucide `Navigation` 아이콘 + `카카오맵 길찾기` (Label, 700), 클릭 시 카카오맵 길찾기 딥링크/웹 URL 새 창 열기. 눌림 `scale(0.98)` 100ms.
- 로딩: 카드와 같은 높이의 스켈레톤(레이아웃 시프트 방지). 위치 권한 거부 시 인라인 배너 + 지도 중심 기본값, 팝업 금지.

## 8. 컴포넌트 규격 요약

| 컴포넌트 | 높이/크기 | 비고 |
|---|---|---|
| 모드 탭 | 56px 컨테이너 / 탭 min 44px | sticky, 전환 200ms |
| 길찾기 버튼 | 48px (최소 44px) | 풀폭, 라운드 12px |
| 필터 칩(카테고리) | 터치 44px | 가로 스크롤 칩 행, 좌우 16px 패딩, 칩 간격 8px |
| 아이콘 버튼 | 44×44px | `aria-label` 필수 |
| 카드 리스트 | 카드 간격 12px | 무한 스크롤/가상화 가능 |

## 9. 모션 & 접근성

- 전환 150–250ms `ease-out`, 눌림 100ms. 레이아웃 속성(width/height) 애니메이션 금지, `transform/opacity`만.
- `prefers-reduced-motion: reduce` 시 모든 전환 제거.
- 텍스트 대비 4.5:1 이상(대형 텍스트 3:1). 포커스 링 제거 금지.
- 다크 모드는 v1 범위 밖. 추후 도입 시 모드별 토큰 세트를 별도로 정의한다.

## 10. 출시 전 체크리스트

- [ ] 375px / 480px 에서 가로 스크롤 없음, `max-w-md` 중앙 정렬
- [ ] 모든 버튼·탭 터치 높이 ≥ 44px, 인접 요소 간격 ≥ 8px
- [ ] 카드가 정확히 `장소명/도보분/태그3/AI요약/길찾기` 구조를 따름
- [ ] 모드별 토큰만 사용(raw hex 없음), 모드 전환 시 팔레트 전체 교체
- [ ] Pretendard 적용, 본문 ≥ 15px, `keep-all` 줄바꿈
- [ ] 로그인/팝업/모달 없음, 아이콘은 Lucide, 이모지 아이콘 없음
- [ ] 색상 단독 정보 전달 없음, 포커스 링 표시, reduced-motion 대응
