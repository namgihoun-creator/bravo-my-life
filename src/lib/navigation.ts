import { useCallback, useSyncExternalStore } from "react";
import { showToast } from "@/lib/toast";
import {
  buildKakaoUrl,
  buildNaverAppUrl,
  buildNaverSearchAppUrl,
  buildNaverSearchWebUrl,
  buildNaverWebUrl,
  buildTmapUrl,
  type NavApp,
  type NavOrigin,
  type NavTarget,
} from "@/lib/navUrls";

export { routeModeFor } from "@/lib/navUrls";
export type { NavApp, NavOrigin, NavTarget } from "@/lib/navUrls";

/**
 * 멀티 길찾기: 카카오맵 / 네이버지도 / 티맵.
 * 선택한 앱은 localStorage(bml_nav_app)에 저장되고, 한 곳에서 바꾸면 모든 카드가 즉시 따라 바뀐다.
 */
export const NAV_APPS: { key: NavApp; label: string; short: string }[] = [
  { key: "kakao", label: "카카오맵", short: "K" },
  { key: "naver", label: "네이버지도", short: "N" },
  { key: "tmap", label: "티맵", short: "T" },
];

export const DEFAULT_NAV_APP: NavApp = "kakao";
const KEY = "bml_nav_app";
const EVENT = "bml-nav-app-change";

export const TMAP_FAIL_MESSAGE = "티맵 앱이 실행되지 않았어요. 모바일에서 티맵 설치 여부를 확인해 주세요.";
const SCHEME_WAIT_MS = 1500;

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

/* ───────────── 실행 ───────────── */

/**
 * 앱 스킴 호출 후 1.5초 안에 화면 이탈(앱 전환)이 없으면 onFail 실행.
 * 모바일은 location.href, 데스크톱은 숨은 iframe으로 시도해 오류 화면/경고가 뜨지 않게 한다.
 */
function launchScheme(url: string, onFail: () => void) {
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
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = url;
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), SCHEME_WAIT_MS + 500);
  }

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onLeave);
    window.removeEventListener("blur", onLeave);
    if (!left && document.visibilityState === "visible") onFail();
  }, SCHEME_WAIT_MS);
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

/** 네이버지도 앱 식별자: 배포 도메인(localhost면 기본값) */
function naverAppName(): string | undefined {
  const host = window.location.hostname;
  return host && host !== "localhost" && host !== "127.0.0.1" ? host : undefined;
}

/**
 * 네이버 장소 검색 열기(영업정보·임시휴무·최근 후기 확인용). 길찾기와 같은 방식: 모바일은 앱 스킴을 먼저 호출하고
 * 1.5초 안에 전환이 없으면 웹 검색으로, 데스크톱은 곧바로 웹 검색을 새 탭으로 연다.
 */
export function openNaverPlaceSearch(query: string) {
  const webUrl = buildNaverSearchWebUrl(query);
  if (!isMobileDevice()) return openExternal(webUrl);
  return launchScheme(buildNaverSearchAppUrl(query, naverAppName()), () => window.location.assign(webUrl));
}

/**
 * 길찾기 실행.
 * - 카카오: 새 탭으로 길찾기 URL
 * - 네이버: 모바일은 앱 스킴(nmap://route/...)을 먼저 호출 → 앱이 열리면 출발지가 '내 위치'로 자동 설정.
 *   1.5초 안에 앱으로 전환되지 않으면(미설치) 웹 경로로 넘어가고, 데스크톱은 곧바로 웹 경로.
 *   웹 경로에는 현재 기준 위치(origin)를 출발지로 채운다. 경로 타입은 공영주차장=자동차, 그 외=도보.
 * - 티맵: tmap:// 스킴, 1.5초 안에 전환이 없으면 안내 토스트
 */
export function openNavigation(app: NavApp, target: NavTarget, origin?: NavOrigin) {
  if (app === "tmap") {
    return launchScheme(buildTmapUrl(target), () => showToast(TMAP_FAIL_MESSAGE));
  }
  if (app === "naver") {
    const webUrl = buildNaverWebUrl(target, origin);
    if (!isMobileDevice()) return openExternal(webUrl);
    // 모바일: 같은 탭으로 웹 경로 이동(비동기 시점의 새 탭 열기는 팝업 차단될 수 있어 location 이동 사용)
    return launchScheme(buildNaverAppUrl(target, naverAppName()), () => window.location.assign(webUrl));
  }
  openExternal(buildKakaoUrl(target));
}
