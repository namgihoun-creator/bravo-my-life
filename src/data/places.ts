export type Mode = "survival" | "nopo";

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
  /** {"ok": 12, "wait": 3} */
  feedback: Record<string, number>;
  distance_m: number;
}

export const FILTERS: Record<Mode, { key: string; label: string }[]> = {
  survival: [
    { key: "all", label: "전체" },
    { key: "laundry", label: "24시 코인세탁" },
    { key: "print", label: "무인프린트" },
    { key: "pharmacy", label: "심야약국" },
    { key: "battery", label: "보조배터리" },
    { key: "parking", label: "🅿️ 공영주차장" },
    { key: "toilet", label: "개방화장실" },
  ],
  nopo: [
    { key: "all", label: "전체" },
    { key: "veteran", label: "업력 20년+" },
    { key: "solo", label: "혼밥성지" },
    { key: "soup", label: "해장·국밥" },
    { key: "pocha", label: "노포포차" },
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

/** 동네 설정 바텀시트의 빠른 선택 거점 (수집 스크립트의 HUBS와 동일, 12곳) */
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
];

export const FALLBACK_LOCATION = { name: "부천역 인근", lat: 37.4844, lng: 126.783 };

const WALK_M_PER_MIN = 80;
const NO_PARKING_TAG = "#주차불가";
const PARKING_LINK_MAX_M = 600;

export function walkMinutes(distanceM: number) {
  return Math.max(1, Math.ceil(distanceM / WALK_M_PER_MIN));
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
