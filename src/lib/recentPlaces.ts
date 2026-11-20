/**
 * 자주 가는 동네(최근 고른 동네, 최대 3곳). 로그인이 없으므로 이 기기의 localStorage 에만 저장한다.
 * - 가장 최근에 고른 곳이 맨 앞이다. 같은 동네(이름 같거나 200m 이내)를 다시 고르면 맨 앞으로 올라온다.
 * - 시작 위치: GPS 허용 → 현재 위치, GPS 불가 → 맨 앞 동네(`lastPlace`), 없으면 기본값(부천역 인근).
 * 읽기는 useSyncExternalStore(서버 스냅샷은 빈 문자열)로 해 하이드레이션 불일치가 없다.
 */
export interface RecentPlace {
  name: string;
  lat: number;
  lng: number;
}

const KEY = "bml_recent_places";
const MAX = 3;
const SAME_M = 200;

const listeners = new Set<() => void>();

export function subscribeRecent(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** useSyncExternalStore 스냅샷: 원문 문자열(같으면 같은 참조라 재렌더가 없다) */
export function getRecentRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export const getRecentRawServer = (): string => "";

export function parseRecent(raw: string): RecentPlace[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: RecentPlace[] = [];
    for (const it of v) {
      if (!it || typeof it !== "object") continue;
      const { name, lat, lng } = it as Record<string, unknown>;
      if (typeof name === "string" && name && name.length <= 40 && Number.isFinite(lat) && Number.isFinite(lng)) {
        out.push({ name, lat: lat as number, lng: lng as number });
      }
      if (out.length >= MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

function distM(a: RecentPlace, b: RecentPlace): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 순수 함수: 새 동네를 맨 앞에 넣고 중복을 걷어 낸 뒤 최대 3곳으로 자른다 */
export function withRecent(list: RecentPlace[], p: RecentPlace): RecentPlace[] {
  const next = [p, ...list.filter((x) => x.name !== p.name && distM(x, p) > SAME_M)];
  return next.slice(0, MAX);
}

function write(list: RecentPlace[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 저장이 막혀도 이번 화면에서는 그대로 동작 */
  }
  listeners.forEach((cb) => cb());
}

/** 사용자가 시트에서 직접 고른 동네만 저장한다(지도 현위치·GPS·자동 폴백은 저장 안 함) */
export function rememberPlace(p: RecentPlace) {
  write(withRecent(parseRecent(getRecentRaw()), p));
}

export function forgetPlace(name: string) {
  write(parseRecent(getRecentRaw()).filter((x) => x.name !== name));
}

/** GPS 를 쓸 수 없을 때의 시작 위치(마지막으로 고른 동네). 없으면 null */
export function lastPlace(): RecentPlace | null {
  return parseRecent(getRecentRaw())[0] ?? null;
}
