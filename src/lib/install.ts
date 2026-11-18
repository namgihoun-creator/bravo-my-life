/**
 * PWA 설치 상태 (모듈 단위 스토어 → useSyncExternalStore).
 * - standalone(홈 화면 앱) 으로 열린 상태면 설치 UI를 숨긴다.
 * - Chrome 의 beforeinstallprompt 를 preventDefault 로 잡아 두었다가 '앱 설치' 버튼에서 prompt() 한다.
 *   (이벤트는 hydrate 전에 올 수 있어 layout <head> 의 인라인 스크립트가 window.__bip 에 먼저 담아 둔다.)
 */
import { useSyncExternalStore } from "react";
import { showToast } from "@/lib/toast";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __bip?: BeforeInstallPromptEvent;
  }
}

export interface InstallState {
  /** 이미 설치된 앱(standalone)이거나 설치가 끝난 상태 → 설치 UI 숨김 */
  installed: boolean;
  /** 브라우저 기본 설치 다이얼로그를 바로 띄울 수 있는 상태 */
  canPrompt: boolean;
}

// 서버/hydrate 직전에는 숨김 상태로 시작해 설치된 앱에서 버튼이 깜빡이지 않게 한다
const SERVER_STATE: InstallState = { installed: true, canPrompt: false };

let state: InstallState = SERVER_STATE;
let started = false;
const listeners = new Set<() => void>();

function set(next: InstallState) {
  if (next.installed === state.installed && next.canPrompt === state.canPrompt) return;
  state = next;
  listeners.forEach((l) => l());
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  set({ installed: isStandalone(), canPrompt: !!window.__bip });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__bip = e as BeforeInstallPromptEvent;
    set({ ...state, canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    window.__bip = undefined;
    set({ installed: true, canPrompt: false });
    showToast("앱이 설치됐어요. 홈 화면에서 열어 보세요.");
  });
  // 설치 직후/브라우저 전환 때 display-mode 가 바뀌면 다시 판별
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", () => {
    set({ ...state, installed: isStandalone() });
  });
}

function subscribe(cb: () => void) {
  start();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    subscribe,
    () => {
      start();
      return state;
    },
    () => SERVER_STATE,
  );
}

/**
 * 저장된 설치 이벤트가 있으면 기본 설치 다이얼로그를 띄우고 true, 없으면 false(→ 안내 시트를 열 것).
 * prompt() 는 이벤트당 한 번만 쓸 수 있어 사용 후 비운다.
 */
export async function promptInstall(): Promise<boolean> {
  const ev = typeof window !== "undefined" ? window.__bip : undefined;
  if (!ev) return false;
  window.__bip = undefined;
  set({ ...state, canPrompt: false });
  try {
    await ev.prompt();
    await ev.userChoice; // 수락이면 appinstalled 이벤트가 토스트를 띄운다
  } catch {
    /* 사용자가 닫거나 브라우저가 거부해도 앱은 그대로 */
  }
  return true;
}
