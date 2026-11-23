/**
 * '이 동네 데이터 요청하기' 접수 기록(이 기기 localStorage 에만). 접수된 격자(cell_key)는 버튼을 '요청 접수됨'으로 바꾼다.
 * 읽기는 useSyncExternalStore(서버 스냅샷은 빈 문자열)라 하이드레이션 불일치가 없다.
 */
const KEY = "bml_area_requested";
const MAX = 20;
const EVENT = "bml-area-requested";

export function subscribeRequested(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function getRequestedRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export const getRequestedRawServer = (): string => "";

export function parseRequested(raw: string): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= 24).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

let memory: string[] = []; // localStorage 를 못 쓰는 환경에서도 이번 화면 동안은 접수 상태 유지

export function markRequested(cellKey: string) {
  const next = [cellKey, ...parseRequested(getRequestedRaw()).filter((k) => k !== cellKey)].slice(0, MAX);
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장이 막혀도 이번 화면에서는 그대로 동작 */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function isRequested(raw: string, cellKey: string): boolean {
  return parseRequested(raw).includes(cellKey) || memory.includes(cellKey);
}
