export type Mode = "survival" | "nopo";

/** 현장 한 줄 팁 (최신순 최대 10개 중 하나) */
export interface FieldTip {
  t: string;
  /** 작성 시각 (ISO, UTC) */
  at: string;
}

/**
 * feedback JSONB: 현장 피드백 칩 카운트({"ok": 12}) + 현장 정보(정기휴무·영업시간·브레이크타임·팁).
 * 현장 정보는 `bml_add_place_tip` RPC가 갱신한다.
 */
export interface PlaceFeedback {
  closed_days?: string[];
  hours?: string;
  break_time?: string;
  tips?: FieldTip[];
  [key: string]: unknown;
}

/** Supabase `bml_get_nearby_places` RPC 반환 행 */
export interface Place {
  id: string;
  mode: Mode;
  /** 주 카테고리: laundry|print|pharmacy|parking|battery | soup|pocha|solo|general */
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
}

export const FILTERS: Record<Mode, { key: string; label: string }[]> = {
  survival: [
    { key: "all", label: "전체" },
    { key: "fav", label: "찜" },
    { key: "laundry", label: "24시 코인세탁" },
    { key: "print", label: "무인프린트" },
    { key: "pharmacy", label: "심야약국" },
    { key: "battery", label: "보조배터리" },
    { key: "parking", label: "🅿️ 공영주차장" },
    { key: "toilet", label: "개방화장실" },
  ],
  nopo: [
    { key: "all", label: "전체" },
    { key: "fav", label: "찜" },
    { key: "y10", label: "10년+" },
    { key: "y15", label: "15년+" },
    { key: "y20", label: "20년+" },
    { key: "y30", label: "30년+" },
  ],
};

export interface FeedbackChipDef {
  key: string;
  emoji: string;
  label: string;
}

const NOPO_CHIPS: FeedbackChipDef[] = [
  { key: "visit", emoji: "🍚", label: "실방문 확인" },
  { key: "again", emoji: "👍", label: "또 가고 싶다" },
];

/** 카테고리별 원클릭 현장 피드백 칩 (key는 DB feedback jsonb 키) */
export const FEEDBACK_CHIPS: Record<string, FeedbackChipDef[]> = {
  laundry: [
    { key: "ok", emoji: "👍", label: "방금 정상이용" },
    { key: "wait", emoji: "⏳", label: "대기 있음" },
  ],
  print: [
    { key: "paper", emoji: "📄", label: "A4용지 충분" },
    { key: "ok", emoji: "👍", label: "방금 정상이용" },
  ],
  pharmacy: [
    { key: "open", emoji: "🟢", label: "영업중 확인" },
    { key: "ok", emoji: "👍", label: "방금 정상이용" },
  ],
  parking: [
    { key: "space", emoji: "🅿️", label: "빈자리 있음" },
    { key: "full", emoji: "🚫", label: "만차" },
  ],
  battery: [
    { key: "stock", emoji: "🔋", label: "재고 있음" },
    { key: "ok", emoji: "👍", label: "방금 정상이용" },
  ],
  toilet: [
    { key: "open", emoji: "🟢", label: "이용 가능" },
    { key: "locked", emoji: "🔒", label: "잠겨있음" },
  ],
  soup: NOPO_CHIPS,
  pocha: NOPO_CHIPS,
  solo: NOPO_CHIPS,
  general: NOPO_CHIPS,
};

/** 동네 설정 바텀시트의 빠른 선택 거점 (수집 스크립트의 HUBS와 동일, 18곳) */
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
  const m = /^y(\d+)$/.exec(key);
  if (m) {
    const y = yearsInBusiness(p);
    return y !== null && y >= Number(m[1]);
  }
  return p.category === key || !!p.extra?.includes(key);
}

/** 노포 음식 업종 라벨 (예: '한식 · 고기·구이'). 수집 스크립트가 extra 배열의 'food:' 항목으로 저장한다. */
export function foodLabel(p: Place): string | null {
  const e = p.extra?.find((x) => x.startsWith("food:"));
  return e ? e.slice(5) : null;
}

/* ───────────── 현장 정보 (정기휴무 · 영업시간 · 브레이크타임 · 한 줄 팁) ───────────── */

export const DAY_CHARS = ["월", "화", "수", "목", "금", "토", "일"] as const;
export const RESERVED_FEEDBACK_KEYS = ["closed_days", "hours", "break_time", "tips"];

export interface FieldInfo {
  closedDays: string[];
  hours: string | null;
  breakTime: string | null;
  tip: FieldTip | null; // 가장 최근 팁
}

export function fieldInfo(p: Place): FieldInfo {
  const fb = p.feedback ?? {};
  const days = Array.isArray(fb.closed_days) ? fb.closed_days.filter((d): d is string => typeof d === "string") : [];
  const tips = Array.isArray(fb.tips) ? fb.tips.filter((t) => t && typeof t.t === "string") : [];
  return {
    closedDays: days,
    hours: typeof fb.hours === "string" && fb.hours ? fb.hours : null,
    breakTime: typeof fb.break_time === "string" && fb.break_time ? fb.break_time : null,
    tip: tips[0] ?? null,
  };
}

/** 피드백 칩 카운트 (현장 정보 키와 섞여 있는 JSONB에서 숫자만 읽는다) */
export function feedbackCount(p: Place, key: string): number {
  const v = p.feedback?.[key];
  return typeof v === "number" ? v : 0;
}

/** '3일 전' 같은 상대 시간 */
export function timeAgo(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || nowMs <= 0) return "";
  const min = Math.max(0, Math.round((nowMs - t) / 60_000));
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}일 전` : `${Math.round(d / 30)}개월 전`;
}
