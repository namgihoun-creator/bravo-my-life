import { useSyncExternalStore } from "react";
import type { Place } from "@/data/places";

/**
 * 찜하기(북마크): 기기에만 저장 (localStorage `bml_favorites`, 로그인 없음).
 * 장소 정보를 통째로 저장해 두어 오프라인이거나 다른 동네를 보고 있어도 '찜' 목록을 즉시 보여줄 수 있다.
 * 값: { [placeId]: Place 스냅샷 }
 */
const KEY = "bml_favorites";
const EVENT = "bml-favorites-change";

export type Favorites = Record<string, Place>;

const EMPTY: Favorites = {};
let cache: Favorites | null = null;

function load(): Favorites {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Favorites) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      cache = null; // 다른 탭에서 바뀐 값을 다시 읽는다
      cb();
    }
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** 찜 목록 (변경될 때만 새 객체가 되므로 useMemo 의존성으로 써도 안전하다) */
export function useFavorites(): Favorites {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}

export function toggleFavorite(place: Place) {
  const next = { ...load() };
  if (next[place.id]) delete next[place.id];
  else next[place.id] = place;
  cache = next; // 저장에 실패해도(사생활 보호 모드 등) 이 세션에서는 유지
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장 불가: 메모리 값으로만 유지 */
  }
  window.dispatchEvent(new Event(EVENT));
}
