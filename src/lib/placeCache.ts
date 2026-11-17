import type { Place } from "@/data/places";

/**
 * 최근 조회한 좌표별 주변 장소 결과 캐시 (localStorage).
 * 지하 주차장·엘리베이터처럼 네트워크가 불안정할 때 직전 결과를 보여주기 위한 용도.
 */
const KEY = "bml_nearby_cache_v1";
const MAX_ENTRIES = 4;
const NEAR_M = 3000; // 이 거리 안의 캐시만 '주변'으로 인정

interface Entry {
  lat: number;
  lng: number;
  t: number; // 저장 시각(ms)
  places: Place[];
}

function readAll(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Entry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function distM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dy = (aLat - bLat) * 111_000;
  const dx = (aLng - bLng) * 111_000 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** 같은 곳(약 100m 격자)은 한 항목으로 합쳐 최근 N개만 보관한다. 저장 공간이 부족하면 오래된 것부터 버린다. */
export function saveNearby(lat: number, lng: number, places: Place[]) {
  const sameCell = (e: Entry) => distM(e.lat, e.lng, lat, lng) < 100;
  let entries = [{ lat, lng, t: Date.now(), places }, ...readAll().filter((e) => !sameCell(e))].slice(
    0,
    MAX_ENTRIES,
  );
  for (let tries = 0; tries < MAX_ENTRIES; tries++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
      return;
    } catch {
      if (entries.length <= 1) return; // 저장 불가 환경이면 포기 (앱은 그대로 동작)
      entries = entries.slice(0, -1);
    }
  }
}

/** 요청 좌표에서 가장 가까운 캐시(3km 이내). 없으면 null. */
export function readNearby(lat: number, lng: number): { places: Place[]; t: number } | null {
  let best: { e: Entry; d: number } | null = null;
  for (const e of readAll()) {
    const d = distM(e.lat, e.lng, lat, lng);
    if (d <= NEAR_M && (!best || d < best.d)) best = { e, d };
  }
  return best ? { places: best.e.places, t: best.e.t } : null;
}
