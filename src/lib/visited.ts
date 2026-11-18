import { useSyncExternalStore } from "react";
import type { Place } from "@/data/places";

/**
 * '다녀온 곳' 체크인 + 한 줄 메모(최대 60자): 기기에 저장 (localStorage `bml_visited`, 로그인 없음).
 * 찜과 같이 장소 스냅샷을 함께 저장해 오프라인·다른 동네에서도 '다녀옴' 목록을 보여준다.
 * 커플 코드를 연결하면 src/lib/couple.ts 가 같은 값을 Supabase 와 실시간으로 맞춘다.
 */
const KEY = "bml_visited";
const EVENT = "bml-visited-change";
export const NOTE_MAX = 60;

export interface VisitedEntry {
  place: Place;
  note: string | null;
  /** 체크인한 시각(ms) */
  at: number;
}
export type VisitedMap = Record<string, VisitedEntry>;

const EMPTY: VisitedMap = {};
let cache: VisitedMap | null = null;

function load(): VisitedMap {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as VisitedMap) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      cache = null;
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

export function useVisited(): VisitedMap {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}

export function getVisited(): VisitedMap {
  return typeof window === "undefined" ? EMPTY : load();
}

export function cleanNote(note: string | null | undefined): string | null {
  const t = (note ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return t || null;
}

function save(next: VisitedMap) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장 불가: 메모리 값으로만 유지 */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** 다녀옴으로 표시하고(이미 표시면 시각 유지) 메모를 바꾼다. 값이 같으면 아무것도 하지 않는다. */
export function setVisited(place: Place, note: string | null, at?: number) {
  const n = cleanNote(note);
  const cur = load()[place.id];
  if (cur && cur.note === n) return;
  save({ ...load(), [place.id]: { place: cur?.place ?? place, note: n, at: cur?.at ?? at ?? Date.now() } });
}

export function removeVisited(id: string) {
  if (!load()[id]) return;
  const next = { ...load() };
  delete next[id];
  save(next);
}
