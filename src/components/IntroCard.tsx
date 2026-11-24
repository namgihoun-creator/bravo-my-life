"use client";

import { useSyncExternalStore } from "react";
import { Info, X } from "lucide-react";

/** 첫 접속 안내 카드 닫힘 기록(앱 최초 진입 1회). 세션당 1회인 스플래시와 별개다. */
const KEY = "bml_intro_seen";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 이미 봤으면 true. 저장소를 못 쓰면 이번 화면에서만 닫힌 상태를 메모리로 기억한다. */
let memorySeen = false;
function read(): boolean {
  if (memorySeen) return true;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
const readServer = () => true; // 서버·하이드레이션 첫 렌더에서는 그리지 않아 불일치와 깜빡임이 없다

/** 카드 X 와 모드 탭 전환 모두 이 함수로 닫는다(다시 뜨지 않는다). */
export function dismissIntro() {
  memorySeen = true;
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* 저장 불가: 메모리 플래그만 */
  }
  listeners.forEach((l) => l());
}

export default function IntroCard() {
  const seen = useSyncExternalStore(subscribe, read, readServer);
  if (seen) return null;
  return (
    <div
      role="note"
      className="theme-t flex items-start gap-2 rounded-xl border border-line bg-tag-bg py-1 pl-3 text-caption font-semibold text-tag-text"
    >
      <Info size={16} aria-hidden className="mt-3 shrink-0" />
      <p className="min-w-0 flex-1 py-2.5 [overflow-wrap:anywhere]">
        급할 땐 생존 모드, 한 끼는 노포 모드 · 위치는 주변 검색에만 쓰이고 저장되지 않아요.
      </p>
      <button
        type="button"
        onClick={dismissIntro}
        aria-label="안내 닫기"
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
