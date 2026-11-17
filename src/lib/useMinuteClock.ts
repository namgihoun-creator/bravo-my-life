import { useSyncExternalStore } from "react";

/** 분 단위로 갱신되는 현재 시각(ms). 서버/하이드레이션 단계에서는 0. */
function subscribe(cb: () => void) {
  const id = window.setInterval(cb, 30_000);
  return () => window.clearInterval(id);
}

const snapshot = () => Math.floor(Date.now() / 60_000) * 60_000;

export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
