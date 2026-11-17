/**
 * 피드백 투표 잠금 스토어 (localStorage 기반).
 * - 이미 투표한 칩은 '취소(-1)'만 가능하고, 투표하지 않은 칩만 '+1' 가능 → +1 무한 누적 방지
 * - 같은 탭의 다른 칩/다른 탭(storage 이벤트)과도 상태가 동기화된다
 * - 서버 요청 전에 먼저 저장해(낙관적 잠금) 요청 중 새로고침해도 중복 +1이 되지 않는다
 */
const KEY = "bml_votes";
const EVENT = "bml-votes-change";

let cache: Set<string> | null = null;

function load(): Set<string> {
  if (cache) return cache;
  try {
    cache = new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    cache = new Set();
  }
  return cache;
}

function emit() {
  cache = null; // 다음 읽기에서 localStorage 값을 다시 읽는다
  window.dispatchEvent(new Event(EVENT));
}

export function hasVoted(id: string): boolean {
  return load().has(id);
}

export function setVoted(id: string, on: boolean) {
  const votes = new Set(load());
  if (on) votes.add(id);
  else votes.delete(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...votes]));
  } catch {
    // 저장 불가(사생활 보호 모드 등): 메모리 캐시로만 잠금 유지
    cache = votes;
    window.dispatchEvent(new Event(EVENT));
    return;
  }
  emit();
}

export function subscribeVotes(cb: () => void) {
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
