export type Mode = "survival" | "nopo";

/**
 * feedback JSONB: 현장 피드백 칩 카운트({"ok": 12}) + 데이터 파이프라인이 넣는 운영 정보(정기휴무·영업시간·브레이크타임).
 * (사용자 입력 '현장 팁'은 제거됨. 예약 키 `tips`는 DB에 남아 있을 수 있어 칩 카운트에서만 제외한다.)
 */
export interface PlaceFeedback {
  closed_days?: string[];
  hours?: string;
  break_time?: string;
  [key: string]: unknown;
}

/** Supabase `bml_get_nearby_places` RPC 반환 행 */
export interface Place {
  id: string;
  mode: Mode;
  /** 주 카테고리: laundry|print|pharmacy|parking|carwash|battery|toilet | soup|pocha|solo|general */
  category: string;
  /** 추가 필터 키 (예: veteran, solo) */
  extra: string[];
  name: string;
  address: string | null;
  place_url: string | null;
  badge: string;
  tags: string[];
  summary: string;
  lat: number;
  lng: number;
  feedback: PlaceFeedback;
  /** 인허가 연도 (RPC 003 마이그레이션 이후 제공) */
  open_year?: number | null;
  distance_m: number;
  /** 최종 데이터 현행화(확인) 시각 — 006 마이그레이션 이후 제공 */
  last_synced_at?: string | null;
  /** 폐업·정보오류 제보 또는 폐업 의심 플래그 ('closed' | 'info_changed') — 006 이후 */
  reported_issue?: "closed" | "info_changed" | null;
  /** 폐업·정보오류 제보 누적 건수 — 006 이후 */
  closure_reports?: number;
  /** 가게 대표 전화(공개된 업소 번호) — 상세 페이지에서만 조회한다(RPC 응답에는 없음) */
  phone?: string | null;
  /** 카카오 장소 id — 상세 페이지의 카카오맵 장소 링크용(RPC 응답에는 없음) */
  kakao_id?: string | null;
}

/** 노포 업종 칩 (건수 많은 순). group = 'food:' 대분류, sub = 소분류. 필터 key 는 'fd:' 접두 */
export const FOOD_CHIPS: { key: string; label: string; group?: string; sub?: string }[] = [
  { key: "fd:meat", label: "고기·구이", sub: "고기·구이" },
  { key: "fd:pub", label: "호프·포차", group: "호프" },
  { key: "fd:snack", label: "분식", group: "분식" },
  { key: "fd:gukbap", label: "국밥·해장", sub: "국밥·해장" },
  { key: "fd:chinese", label: "중식", group: "중식" },
  { key: "fd:japanese", label: "일식", group: "일식" },
  { key: "fd:seafood", label: "해물·생선", sub: "해물·생선" },
  { key: "fd:noodle", label: "면·칼국수", sub: "면·칼국수" },
  { key: "fd:chicken", label: "치킨·통닭", group: "치킨" },
  { key: "fd:jokbal", label: "족발·보쌈", sub: "족발·보쌈" },
  { key: "fd:stew", label: "백반·찌개", sub: "백반·찌개" },
  { key: "fd:western", label: "양식", group: "양식" },
];

export const FILTERS: Record<Mode, { key: string; label: string }[]> = {
  survival: [
    { key: "all", label: "전체" },
    { key: "fav", label: "찜" },
    { key: "laundry", label: "24시 코인세탁" },
    { key: "print", label: "무인프린트" },
    { key: "pharmacy", label: "심야약국" },
    { key: "battery", label: "보조배터리" },
    { key: "parking", label: "공영주차장" },
    { key: "carwash", label: "세차장" },
    { key: "toilet", label: "개방화장실" },
  ],
  nopo: [
    { key: "all", label: "전체" },
    { key: "fav", label: "찜" },
    { key: "y10", label: "10년+" },
    { key: "y15", label: "15년+" },
    { key: "y20", label: "20년+" },
    { key: "y30", label: "30년+" },
    // 업종 칩: 수집 스크립트가 extra 'food:대분류 · 소분류'로 저장한 값 기준 (0건이면 칩 숨김)
    ...FOOD_CHIPS.map(({ key, label }) => ({ key, label })),
  ],
};

export interface FeedbackChipDef {
  key: string;
  /** CategoryIcon 키 (이모지는 쓰지 않는다 — 라인 아이콘으로 통일) */
  icon: string;
  label: string;
}

const NOPO_CHIPS: FeedbackChipDef[] = [
  { key: "visit", icon: "fb:meal", label: "실방문 확인" },
  { key: "again", icon: "fb:thumbs", label: "또 가고 싶다" },
];

/** 카테고리별 원클릭 현장 피드백 칩 (key는 DB feedback jsonb 키) */
export const FEEDBACK_CHIPS: Record<string, FeedbackChipDef[]> = {
  laundry: [
    { key: "ok", icon: "fb:thumbs", label: "방금 정상이용" },
    { key: "wait", icon: "fb:hourglass", label: "대기 있음" },
  ],
  print: [
    { key: "paper", icon: "fb:file", label: "A4용지 충분" },
    { key: "ok", icon: "fb:thumbs", label: "방금 정상이용" },
  ],
  pharmacy: [
    { key: "open", icon: "fb:open", label: "영업중 확인" },
    { key: "ok", icon: "fb:thumbs", label: "방금 정상이용" },
  ],
  parking: [
    { key: "space", icon: "fb:space", label: "빈자리 있음" },
    { key: "full", icon: "fb:full", label: "만차" },
  ],
  carwash: [
    { key: "ok", icon: "fb:thumbs", label: "방금 정상이용" },
    { key: "wait", icon: "fb:hourglass", label: "대기 있음" },
  ],
  battery: [
    { key: "stock", icon: "fb:battery", label: "재고 있음" },
    { key: "ok", icon: "fb:thumbs", label: "방금 정상이용" },
  ],
  toilet: [
    { key: "open", icon: "fb:open", label: "이용 가능" },
    { key: "locked", icon: "fb:locked", label: "잠겨있음" },
  ],
  soup: NOPO_CHIPS,
  pocha: NOPO_CHIPS,
  solo: NOPO_CHIPS,
  general: NOPO_CHIPS,
};

/** 동네 설정 바텀시트의 빠른 선택 거점 (수집 스크립트의 HUBS와 동일, 54곳) */
export const HUBS: { name: string; lat: number; lng: number }[] = [
  { name: "홍대입구역", lat: 37.5572, lng: 126.9245 },
  { name: "성수역", lat: 37.5446, lng: 127.056 },
  { name: "신림역", lat: 37.4842, lng: 126.9293 },
  { name: "노량진역", lat: 37.5133, lng: 126.9425 },
  { name: "건대입구역", lat: 37.5404, lng: 127.0692 },
  { name: "강남역", lat: 37.4979, lng: 127.0276 },
  { name: "잠실역", lat: 37.5133, lng: 127.1001 },
  { name: "부천역", lat: 37.4844, lng: 126.783 },
  { name: "수원역", lat: 37.266, lng: 127.0 },
  { name: "판교역", lat: 37.3948, lng: 127.1112 },
  { name: "안양역", lat: 37.4017, lng: 126.9227 },
  { name: "정발산역", lat: 37.6595, lng: 126.7733 },
  { name: "송내역", lat: 37.4875, lng: 126.7534 },
  { name: "영등포역", lat: 37.5156, lng: 126.9076 },
  { name: "사당역", lat: 37.4765, lng: 126.9816 },
  { name: "신촌역", lat: 37.5551, lng: 126.9368 },
  { name: "서현역", lat: 37.3846, lng: 127.1231 },
  { name: "부평역", lat: 37.4896, lng: 126.7243 },
  { name: "을지로3가역", lat: 37.5663, lng: 126.991 },
  { name: "종로3가역", lat: 37.5704, lng: 126.9922 },
  { name: "공덕역", lat: 37.5445, lng: 126.9515 },
  { name: "문래역", lat: 37.518, lng: 126.8948 },
  { name: "삼각지역", lat: 37.5344, lng: 126.9729 },
  { name: "왕십리역", lat: 37.5613, lng: 127.0371 },
  { name: "천호역", lat: 37.5385, lng: 127.1239 },
  { name: "연신내역", lat: 37.6192, lng: 126.9211 },
  { name: "노원역", lat: 37.6563, lng: 127.0634 },
  { name: "구리역", lat: 37.6033, lng: 127.1434 },
  { name: "의정부역", lat: 37.7384, lng: 127.046 },
  { name: "화정역", lat: 37.6346, lng: 126.8327 },
  { name: "중앙역(안산)", lat: 37.316, lng: 126.8388 },
  { name: "범계역", lat: 37.3898, lng: 126.9508 },
  { name: "모란역", lat: 37.434, lng: 127.13 },
  { name: "수지구청역", lat: 37.3225, lng: 127.0947 },
  { name: "철산역", lat: 37.4762, lng: 126.8682 },
  { name: "정왕역", lat: 37.3517, lng: 126.7434 },
  // 생활권 보강: 수원 전역·근교, 서울 남부(샤로수길·낙성대·이수), 부천 (collect_data.py HUBS 와 동일)
  { name: "행궁동", lat: 37.2819, lng: 127.0148 },
  { name: "인계동", lat: 37.2619, lng: 127.0309 },
  { name: "영통역", lat: 37.2515, lng: 127.0713 },
  { name: "광교중앙역", lat: 37.2884, lng: 127.0517 },
  { name: "망포역", lat: 37.2457, lng: 127.0573 },
  { name: "화서역", lat: 37.284, lng: 126.9896 },
  { name: "장안구청", lat: 37.3039, lng: 127.0103 },
  { name: "호매실", lat: 37.2664, lng: 126.9579 },
  { name: "동탄역", lat: 37.1999, lng: 127.0957 },
  { name: "병점역", lat: 37.2068, lng: 127.0332 },
  { name: "죽전역", lat: 37.3244, lng: 127.1075 },
  { name: "기흥역", lat: 37.2755, lng: 127.117 },
  { name: "의왕역", lat: 37.3203, lng: 126.948 },
  { name: "샤로수길(서울대입구역)", lat: 37.4813, lng: 126.9527 },
  { name: "낙성대역", lat: 37.4771, lng: 126.9635 },
  { name: "이수역", lat: 37.4853, lng: 126.9817 },
  { name: "중동역", lat: 37.4867, lng: 126.7645 },
  { name: "상동역", lat: 37.5058, lng: 126.7532 },
];

/** 동네 설정 시트의 거점 칩 권역 묶음. 여기에 없는 거점은 시트에서 '기타'로 자동 분류된다. */
export const HUB_GROUPS: { label: string; names: string[] }[] = [
  {
    label: "서울",
    names: [
      "홍대입구역", "신촌역", "공덕역", "삼각지역", "을지로3가역", "종로3가역", "왕십리역", "성수역", "건대입구역", "잠실역", "천호역",
      "강남역", "이수역", "사당역", "낙성대역", "샤로수길(서울대입구역)", "신림역", "노량진역", "영등포역", "문래역", "연신내역", "노원역",
    ],
  },
  {
    label: "경기 남부 (수원·용인·화성)",
    names: [
      "수원역", "행궁동", "인계동", "영통역", "광교중앙역", "망포역", "화서역", "장안구청", "호매실",
      "동탄역", "병점역", "죽전역", "기흥역", "수지구청역", "의왕역",
    ],
  },
  { label: "경기 중부 (성남·안양·안산·시흥)", names: ["판교역", "서현역", "모란역", "안양역", "범계역", "중앙역(안산)", "정왕역"] },
  { label: "인천·부천·광명", names: ["부천역", "중동역", "상동역", "송내역", "부평역", "철산역"] },
  { label: "경기 북부", names: ["정발산역", "화정역", "의정부역", "구리역"] },
];

export const FALLBACK_LOCATION = { name: "부천역 인근", lat: 37.4844, lng: 126.783 };

const WALK_M_PER_MIN = 80;
const NO_PARKING_TAG = "#주차불가";
const PARKING_LINK_MAX_M = 600;

export function walkMinutes(distanceM: number) {
  return Math.max(1, Math.ceil(distanceM / WALK_M_PER_MIN));
}

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number) {
  return haversineM(aLat, aLng, bLat, bLng);
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 노포 카드에 붙일 '가장 가까운 공영주차장' (좌표 기반 계산).
 * `#주차불가` 태그가 있거나, 600m 이내에 공영주차장이 있는 노포 카드에 표시한다.
 */
export function nearestParking(
  place: Place,
  all: Place[],
): { parking: Place; walkMin: number } | null {
  if (place.mode !== "nopo") return null;
  let best: { parking: Place; m: number } | null = null;
  for (const p of all) {
    if (p.category !== "parking") continue;
    const m = haversineM(place.lat, place.lng, p.lat, p.lng);
    if (!best || m < best.m) best = { parking: p, m };
  }
  if (!best) return null;
  if (!place.tags.includes(NO_PARKING_TAG) && best.m > PARKING_LINK_MAX_M) return null;
  return { parking: best.parking, walkMin: walkMinutes(best.m) };
}

/** '장소 제보' 폼의 모드별 카테고리 (서버 라우트의 화이트리스트와 동일해야 한다) */
export const REPORT_CATEGORIES: Record<Mode, { key: string; label: string }[]> = {
  survival: [
    { key: "laundry", label: "코인세탁" },
    { key: "print", label: "무인프린트" },
    { key: "pharmacy", label: "심야약국" },
    { key: "parking", label: "공영주차장" },
    { key: "carwash", label: "세차장" },
    { key: "battery", label: "보조배터리" },
    { key: "toilet", label: "개방화장실" },
  ],
  nopo: [
    { key: "soup", label: "해장·국밥" },
    { key: "pocha", label: "노포포차" },
    { key: "solo", label: "혼밥성지" },
    { key: "general", label: "기타 노포" },
  ],
};

/* ───────────── 노포 업력 ───────────── */

const USER_REPORT_TAG = "#유저제보";
const CURRENT_YEAR = new Date().getFullYear();

/**
 * 인허가 기준 업력(년). open_year가 있으면 올해 기준으로 계산하고,
 * 아직 RPC가 open_year를 주지 않으면 '업력 N년' 뱃지 텍스트로 대체한다. 모르면 null.
 */
export function yearsInBusiness(p: Place): number | null {
  if (typeof p.open_year === "number") return CURRENT_YEAR - p.open_year;
  const m = /^업력\s*(\d+)년/.exec(p.badge ?? "");
  return m ? Number(m[1]) : null;
}

/** 업력 4단계: 1=10~14년, 2=15~19년, 3=20~29년, 4=30년+ (뱃지 색 구간) */
export function ageTier(years: number): 1 | 2 | 3 | 4 {
  if (years >= 30) return 4;
  if (years >= 20) return 3;
  if (years >= 15) return 2;
  return 1;
}

/** 노포 모드 기본 노출 조건: 업력 10년 이상으로 검증된 곳 또는 유저 제보. (연식 미확정 '노포 후보'는 숨김) */
export function isVisiblePlace(p: Place): boolean {
  if (p.mode !== "nopo") return true;
  if (p.tags.includes(USER_REPORT_TAG)) return true;
  const y = yearsInBusiness(p);
  return y !== null && y >= 10;
}

/** 필터 칩 매칭 (업력 칩은 'y10' 형태 — N년 이상) */
export function matchesFilter(p: Place, key: string): boolean {
  if (key === "all" || key === "fav") return true; // 'fav'는 찜 목록을 미리 골라 둔 풀에서 쓰므로 추가 조건 없음
  if (key.startsWith("fd:")) {
    const chip = FOOD_CHIPS.find((c) => c.key === key);
    const label = p.extra?.find((x) => x.startsWith("food:"))?.slice(5);
    if (!chip || !label) return false;
    const [group, sub] = label.split(" · "); // 예: '한식 · 고기·구이'
    return chip.sub ? sub === chip.sub : group === chip.group;
  }
  const m = /^y(\d+)$/.exec(key);
  if (m) {
    const y = yearsInBusiness(p);
    return y !== null && y >= Number(m[1]);
  }
  return p.category === key || !!p.extra?.includes(key);
}

/**
 * 빠른 키워드 검색: 상호·요약·태그·부가정보(extra: 세차유형·편의시설·업종 등)·주소에서 부분 일치.
 * 대소문자·공백은 무시하고, 공백으로 나눈 단어는 모두(AND) 들어 있어야 한다. 예: '셀프 세차', '24시', '국밥'.
 */
export function matchesQuery(p: Place, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = [p.name, p.summary, p.address, ...(p.tags ?? []), ...(p.extra ?? []).filter((e) => !e.startsWith("llm_hours:"))]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, "");
  return terms.every((t) => hay.includes(t));
}

/** 노포 음식 업종 라벨 (예: '한식 · 고기·구이'). 수집 스크립트가 extra 배열의 'food:' 항목으로 저장한다. */
export function foodLabel(p: Place): string | null {
  const e = p.extra?.find((x) => x.startsWith("food:"));
  return e ? e.slice(5) : null;
}

/* ───────────── 운영 정보 (정기휴무 · 영업시간 · 브레이크타임) ───────────── */

export const DAY_CHARS = ["월", "화", "수", "목", "금", "토", "일"] as const;
export const RESERVED_FEEDBACK_KEYS = ["closed_days", "hours", "break_time", "tips"];

export interface FieldInfo {
  closedDays: string[];
  hours: string | null;
  breakTime: string | null;
}

export function fieldInfo(p: Place): FieldInfo {
  const fb = p.feedback ?? {};
  const days = Array.isArray(fb.closed_days) ? fb.closed_days.filter((d): d is string => typeof d === "string") : [];
  return {
    closedDays: days,
    hours: typeof fb.hours === "string" && fb.hours ? fb.hours : null,
    breakTime: typeof fb.break_time === "string" && fb.break_time ? fb.break_time : null,
  };
}

/** 피드백 칩 카운트 (현장 정보 키와 섞여 있는 JSONB에서 숫자만 읽는다) */
export function feedbackCount(p: Place, key: string): number {
  const v = p.feedback?.[key];
  return typeof v === "number" ? v : 0;
}

/* ───────────── 공영주차장 요금 ───────────── */

export interface FeeEntry {
  text: string;
  /** true: 무료 개방(주말·공휴일 무료 등) / false: 요금 체계 */
  free: boolean;
}

const FREE_WINDOW = /(평일|주말|토요일|일요일|공휴일|야간|주중)/;

/** extra 의 'fee:' 항목 → 카드 강조용 요금/무료 개방 정보 (요금 체계가 먼저) */
export function feeEntries(p: Place): FeeEntry[] {
  return (p.extra ?? [])
    .filter((e) => e.startsWith("fee:"))
    .map((e) => e.slice(4))
    .map((text) => ({ text, free: text === "무료" || FREE_WINDOW.test(text) }))
    .sort((a, b) => Number(a.free) - Number(b.free));
}

/* ───────────── 세차장·화장실 이용 정보 (extra: type: / hours: / closed: / facility:) ───────────── */

export interface PlaceMeta {
  /** 세차 유형 (셀프세차·손세차·자동세차·세차장) */
  type: string | null;
  /** 운영·개방시간 ('24시간', '09:00~18:00', '평일 09:00~18:00') */
  hours: string | null;
  /** 휴무일 ('일요일·공휴일') */
  closed: string | null;
  /** 편의시설 (장애인화장실·기저귀교환대·비상벨) */
  facilities: string[];
}

export function placeMeta(p: Place): PlaceMeta {
  const get = (prefix: string) => (p.extra ?? []).find((e) => e.startsWith(prefix))?.slice(prefix.length) ?? null;
  return {
    type: get("type:"),
    hours: get("hours:"),
    closed: get("closed:"),
    facilities: (p.extra ?? []).filter((e) => e.startsWith("facility:")).map((e) => e.slice(9)),
  };
}

/* ───────────── 데이터 기준일 · 폐업/정보오류 제보 ───────────── */

const KST_YM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" });

/** last_synced_at → '2026.11 확인' (정보가 없으면 null: 006 마이그레이션 전에는 표시하지 않는다) */
export function syncedLabel(p: Place): string | null {
  if (!p.last_synced_at) return null;
  const d = new Date(p.last_synced_at);
  if (Number.isNaN(d.getTime())) return null;
  const parts = KST_YM.formatToParts(d);
  const y = parts.find((x) => x.type === "year")?.value;
  const m = parts.find((x) => x.type === "month")?.value;
  return y && m ? `${y}.${m} 확인` : null;
}

export type IssueType = "closed" | "info_changed";
