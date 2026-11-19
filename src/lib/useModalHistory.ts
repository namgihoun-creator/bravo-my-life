"use client";

import { useEffect, useRef } from "react";

/**
 * 오버레이(바텀시트·모달) 히스토리 스택 관리자.
 * - 열릴 때 pushState 1개, 기기 뒤로가기(popstate)는 가장 위 오버레이만 닫는다(LIFO).
 * - UI 버튼으로 닫으면 쌓아 둔 엔트리를 history.back()으로 걷어 내고, 그때 발생하는 popstate는 무시한다.
 * - push는 microtask로 미룬다: StrictMode의 mount→cleanup→mount가 같은 태스크라 중복 push가 생기지 않는다.
 * - 되돌리는 back()이 끝나기 전에는 새 push를 보류해(pendingBacks) 연속 열기·닫기에서 새 팝업이 닫히지 않게 한다.
 * - 열려 있는 동안 body 스크롤을 잠그고(카운터), 마지막 오버레이가 닫히면 복원한다.
 */
type Entry = { close: () => void; pushed: boolean; done: boolean };

const stack: Entry[] = [];
let pendingBacks = 0;
let listening = false;
let flushScheduled = false;
let prevOverflow = "";

function lockScroll() {
  if (stack.length === 1) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}

function unlockScroll() {
  if (stack.length === 0) document.body.style.overflow = prevOverflow;
}

function flush() {
  flushScheduled = false;
  if (pendingBacks > 0) return;
  for (const e of stack) {
    if (!e.pushed && !e.done) {
      window.history.pushState({ bmlOverlay: true }, "");
      e.pushed = true;
    }
  }
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function remove(e: Entry) {
  e.done = true;
  const i = stack.indexOf(e);
  if (i >= 0) stack.splice(i, 1);
  unlockScroll();
}

function onPop() {
  if (pendingBacks > 0) {
    pendingBacks--;
    if (pendingBacks === 0) flush();
    return;
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const e = stack[i];
    if (e.pushed) {
      remove(e);
      e.close();
      return;
    }
  }
}

function register(close: () => void): Entry {
  if (!listening) {
    window.addEventListener("popstate", onPop);
    listening = true;
  }
  const e: Entry = { close, pushed: false, done: false };
  stack.push(e);
  lockScroll();
  scheduleFlush();
  return e;
}

function unregister(e: Entry) {
  if (e.done) return; // 뒤로가기로 이미 닫힌 경우: 히스토리는 브라우저가 걷어 냈다
  remove(e);
  if (e.pushed) {
    pendingBacks++;
    window.history.back();
  }
}

/** 컴포넌트가 마운트되어 있는 동안(=팝업이 열려 있는 동안) 뒤로가기로 닫히게 한다. */
export function useModalHistory(onClose: () => void, active = true) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!active) return;
    const entry = register(() => closeRef.current());
    return () => unregister(entry);
  }, [active]);
}
