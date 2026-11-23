import type { Place } from "@/data/places";
import { distanceM } from "@/data/places";

/**
 * 미등록 지역 실시간 폴백(카카오 카테고리 검색 PM9 약국·PK6 주차장) 공용 코드. 서버·클라이언트가 함께 쓴다.
 * 이 결과는 DB 행이 아니다: id 가 `live:<카카오id>` 이고, 찜·다녀옴(커플 동기화)·피드백·오류 제보·상세 페이지·오프라인 캐시에 넣지 않는다.
 */
export const LIVE_PREFIX = "live:";
export const isLive = (id: string): boolean => id.startsWith(LIVE_PREFIX);

/** 요청 좌표 격자: 0.005°(약 500m). 클라이언트가 먼저 맞춰 보내야 같은 격자의 요청이 같은 URL 이 되어 CDN 캐시가 먹는다. */
const STEP = 0.005;
export function snapLive(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Number((Math.round(lat / STEP) * STEP).toFixed(3)),
    lng: Number((Math.round(lng / STEP) * STEP).toFixed(3)),
  };
}

/** 서버 조회 반경(격자 중심 기준) — 격자 오차(최대 약 350m)를 더해도 실제 위치 1km 를 덮는다 */
export const LIVE_SERVER_RADIUS_M = 1500;
/** 화면에 보여 줄 실제 위치 기준 반경 */
export const LIVE_SHOW_RADIUS_M = 1000;

export type LiveCategory = "pharmacy" | "parking";

/** /api/live-nearby 응답 항목 */
export interface LiveDoc {
  id: string; // 카카오 장소 id(숫자)
  name: string;
  category: LiveCategory;
  address: string | null;
  lat: number;
  lng: number;
}

export const LIVE_LABEL: Record<LiveCategory, string> = {
  pharmacy: "약국 (영업시간 미확인)",
  parking: "주차장 (공영 여부·요금 미확인)",
};

export const LIVE_NOTICE =
  "이 지역은 아직 정보가 등록되지 않아 카카오 지도 검색 결과를 보여 드려요. 영업 여부는 직접 확인해 주세요";

/** 카카오 장소 id(숫자) → 장소 페이지(검색이 아니라 장소 하나를 가리킨다) */
export const liveKakaoUrl = (place: Pick<Place, "id">): string | null => {
  const id = place.id.slice(LIVE_PREFIX.length);
  return /^\d{1,20}$/.test(id) ? `https://place.map.kakao.com/${id}` : null;
};

/** 응답 → Place. 거리는 격자 중심이 아니라 실제 기준 위치에서 다시 잰다. */
export function toLivePlace(d: LiveDoc, from: { lat: number; lng: number }): Place {
  const parking = d.category === "parking";
  return {
    id: `${LIVE_PREFIX}${d.id}`,
    mode: "survival",
    category: d.category,
    extra: [],
    name: d.name,
    address: d.address,
    place_url: `https://place.map.kakao.com/${d.id}`,
    badge: "실시간 검색",
    tags: parking ? ["#실시간검색", "#공영여부미확인", "#요금미확인"] : ["#실시간검색", "#영업시간미확인"],
    summary: parking
      ? "등록 전 지역이라 카카오 지도 검색 결과를 그대로 보여 드려요. 공영 여부와 요금은 직접 확인해 주세요."
      : "등록 전 지역이라 카카오 지도 검색 결과를 그대로 보여 드려요. 영업시간은 직접 확인해 주세요.",
    lat: d.lat,
    lng: d.lng,
    feedback: {},
    open_year: null,
    distance_m: distanceM(from.lat, from.lng, d.lat, d.lng),
    last_synced_at: null,
    reported_issue: null,
    closure_reports: 0,
  };
}

/** 응답 배열을 검증해 실제 위치 1km 안만 거리순으로 돌려준다(형식이 이상한 항목은 버린다) */
export function livePlacesFrom(raw: unknown, from: { lat: number; lng: number }): Place[] {
  if (!Array.isArray(raw)) return [];
  const out: Place[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const d = it as Record<string, unknown>;
    if (
      typeof d.id !== "string" ||
      !/^\d{1,20}$/.test(d.id) ||
      typeof d.name !== "string" ||
      (d.category !== "pharmacy" && d.category !== "parking") ||
      !Number.isFinite(d.lat) ||
      !Number.isFinite(d.lng)
    ) {
      continue;
    }
    const p = toLivePlace(
      {
        id: d.id,
        name: d.name.slice(0, 60),
        category: d.category,
        address: typeof d.address === "string" ? d.address.slice(0, 100) : null,
        lat: d.lat as number,
        lng: d.lng as number,
      },
      from,
    );
    if (p.distance_m <= LIVE_SHOW_RADIUS_M) out.push(p);
  }
  return out.sort((a, b) => a.distance_m - b.distance_m);
}
