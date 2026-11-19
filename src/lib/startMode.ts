import type { Mode } from "@/data/places";

/**
 * 첫 화면 모드 결정.
 * - 평소: 사용자가 마지막으로 직접 고른 모드를 기억한다(localStorage).
 * - 심야(23~05시 Asia/Seoul)에 앱을 '새로 열 때'(= 이 탭/앱 세션의 첫 진입)만 긴급 생존 모드로 연다.
 *   심야 강제값은 저장하지 않는다 → 다음 날 낮에는 원래 고른 모드로 열린다.
 * - 같은 세션에서 백그라운드 복귀·새로고침은 개입하지 않는다(sessionStorage 플래그).
 */
const MODE_KEY = "bml_last_mode";
const SESSION_KEY = "bml_session_started";

/** 심야(23:00~04:59, Asia/Seoul)인가 */
export function isLateNight(nowMs: number): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" }).format(nowMs),
  );
  return hour >= 23 || hour < 5;
}

/** 저장된 모드와 세션·시각으로 시작 모드를 정하는 순수 함수(테스트·재사용용) */
export function decideStartMode(opts: { stored: Mode | null; newSession: boolean; nowMs: number }): Mode {
  if (opts.newSession && isLateNight(opts.nowMs)) return "survival";
  return opts.stored ?? "survival";
}

function readStored(): Mode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "survival" || v === "nopo" ? v : null;
  } catch {
    return null;
  }
}

/** 이번 세션의 첫 호출이면 true (이후 호출은 false). 저장이 막히면 새 세션으로 보지 않는다. */
function markSessionStart(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return false;
    sessionStorage.setItem(SESSION_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

let resolved: Mode | null = null; // StrictMode 이중 effect 실행에서도 같은 결과를 돌려주기 위한 캐시(페이지 수명)

/** 마운트 시 호출. 세션 시작 플래그도 여기서 소비하며, 같은 페이지에서는 항상 같은 값을 돌려준다. */
export function resolveStartMode(): Mode {
  if (resolved) return resolved;
  resolved = decideStartMode({ stored: readStored(), newSession: markSessionStart(), nowMs: Date.now() });
  return resolved;
}

/** 사용자가 모드 탭을 직접 눌렀을 때만 저장한다(심야 자동 전환·주차 연결 등 코드가 바꾼 모드는 저장하지 않는다). */
export function rememberMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* 저장이 막혀도 이번 화면에서는 그대로 동작 */
  }
}
