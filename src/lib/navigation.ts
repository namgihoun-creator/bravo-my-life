import { useCallback, useSyncExternalStore } from "react";
import { showToast } from "@/lib/toast";

/**
 * 멀티 길찾기: 카카오맵 / 네이버지도 / 티맵.
 * 선택한 앱은 localStorage(bml_nav_app)에 저장되고, 한 곳에서 바꾸면 모든 카드가 즉시 따라 바뀐다.
 */
export type NavApp = "kakao" | "naver" | "tmap";

export const NAV_APPS: { key: NavApp; label: string; short: string }[] = [
  { key: "kakao", label: "카카오맵", short: "K" },
  { key: "naver", label: "네이버지도", short: "N" },
  { key: "tmap", label: "티맵", short: "T" },
];

export const DEFAULT_NAV_APP: NavApp = "kakao";
const KEY = "bml_nav_app";
const EVENT = "bml-nav-app-change";

export const TMAP_FAIL_MESSAGE = "티맵 앱이 실행되지 않았어요. 모바일에서 티맵 설치 여부를 확인해 주세요.";
const TMAP_WAIT_MS = 1500;

export interface NavTarget {
  name: string;
  lat: number;
  lng: number;
}

/* ───────────── 선택 상태 (localStorage + React 동기화) ───────────── */

const isNavApp = (v: unknown): v is NavApp => v === "kakao" || v === "naver" || v === "tmap";

function readApp(): NavApp {
  try {
    const v = localStorage.getItem(KEY);
    return isNavApp(v) ? v : DEFAULT_NAV_APP;
  } catch {
    return DEFAULT_NAV_APP;
  }
}

let memoryApp: NavApp | null = null; // localStorage를 못 쓰는 환경(사생활 보호 모드)에서도 세션 동안 유지

function currentApp(): NavApp {
  return memoryApp ?? readApp();
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      memoryApp = null;
      cb();
    }
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage); // 다른 탭에서 바꾼 경우
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setNavApp(app: NavApp) {
  memoryApp = app;
  try {
    localStorage.setItem(KEY, app);
  } catch {
    /* 저장 불가: 메모리 값으로만 유지 */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** [현재 선택된 길찾기 앱, 변경 함수] — 모든 사용처가 같은 값을 즉시 공유한다 */
export function useNavApp(): [NavApp, (app: NavApp) => void] {
  const app = useSyncExternalStore(subscribe, currentApp, () => DEFAULT_NAV_APP);
  const set = useCallback((a: NavApp) => setNavApp(a), []);
  return [app, set];
}

/* ───────────── URL 생성 ───────────── */

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function buildNavUrl(app: NavApp, { name, lat, lng }: NavTarget): string {
  const n = encodeURIComponent(name);
  switch (app) {
    case "kakao":
      return `https://map.kakao.com/link/to/${n},${lat},${lng}`;
    case "naver":
      // 네이버지도 통합 경로(/p/directions): 모바일은 앱/웹, 데스크톱은 웹으로 자연스럽게 이어진다
      return `https://map.naver.com/p/directions/-/${lng},${lat},${n}/-/transit`;
    case "tmap":
      return `tmap://route?goalname=${n}&goalx=${lng}&goaly=${lat}`;
  }
}

/* ───────────── 실행 ───────────── */

/** 티맵 스킴 호출 후 1.5초 안에 화면이 그대로면(앱 미설치/PC) 안내 토스트 */
function launchTmap(url: string) {
  let left = false;
  const onLeave = () => {
    left = true;
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") left = true;
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("blur", onLeave);

  if (isMobileDevice()) {
    window.location.href = url;
  } else {
    // 데스크톱 브라우저에서 알 수 없는 스킴으로 이동해 오류 화면/경고가 뜨지 않게 숨은 iframe으로 시도
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = url;
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), TMAP_WAIT_MS + 500);
  }

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onLeave);
    window.removeEventListener("blur", onLeave);
    if (!left && document.visibilityState === "visible") showToast(TMAP_FAIL_MESSAGE);
  }, TMAP_WAIT_MS);
}

/**
 * 외부 지도 열기. 사용자 탭 안에서 실행되는 <a target="_blank"> 클릭은 팝업 차단 대상이 아니고,
 * 모바일 브라우저/PWA에서 유니버설 링크(앱 전환)도 정상 동작한다. (window.open + noopener 는 성공 여부를 알 수 없고
 * 일부 환경에서 차단되므로 쓰지 않는다)
 */
function openExternal(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function openNavigation(app: NavApp, target: NavTarget) {
  const url = buildNavUrl(app, target);
  if (app === "tmap") return launchTmap(url);
  openExternal(url);
}
