import { useSyncExternalStore } from "react";

/** 목록 보기 형태: 카드형(기본) / 컴팩트 리스트형. 사용자가 고른 값을 localStorage 에 기억한다. */
export type ListStyle = "card" | "compact";
const KEY = "bml_list_style";
const listeners = new Set<() => void>();

function read(): ListStyle {
  try {
    return localStorage.getItem(KEY) === "compact" ? "compact" : "card";
  } catch {
    return memory;
  }
}
let memory: ListStyle = "card"; // 저장소를 못 쓰는 환경에서는 이번 화면에서만 기억한다

export function setListStyle(v: ListStyle) {
  memory = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 저장 불가: 메모리 값만 */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb); // 다른 탭에서 바꾼 값도 따라간다
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** 서버·하이드레이션 첫 렌더는 항상 card, 마운트 뒤 저장값으로 바뀐다(useSyncExternalStore 가 불일치 없이 처리) */
export function useListStyle(): ListStyle {
  return useSyncExternalStore(subscribe, read, () => "card");
}
