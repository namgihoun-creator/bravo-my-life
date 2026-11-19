/* Bravo My Life — 경량 서비스 워커
 * - 앱 셸('/'), 아이콘, 매니페스트를 미리 캐시해 홈 화면 앱 실행을 빠르게 하고 오프라인에서도 열리게 한다.
 * - 페이지 이동: 네트워크 우선(4초 타임아웃) → 실패 시 캐시된 셸('/place/*' 상세도 오프라인이면 앱 셸로 연다). 항상 최신 배포를 먼저 받는다.
 * - /_next/static (해시된 정적 파일), Pretendard 폰트: 캐시 우선. 아이콘/매니페스트: 캐시 후 백그라운드 갱신.
 * - /api/* 와 Supabase·카카오 같은 외부 API는 절대 캐시하지 않는다 (주변 장소 데이터는 앱이 localStorage에 따로 보관).
 * 배포 때 캐시 구조를 바꾸면 VERSION 을 올려 이전 캐시를 정리한다.
 */
const VERSION = "v2";
const SHELL_CACHE = `bml-shell-${VERSION}`;
const RUNTIME_CACHE = `bml-runtime-${VERSION}`;
const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];
const FONT_HOST = "cdn.jsdelivr.net";
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function navigationHandler(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await withTimeout(fetch(request), NAV_TIMEOUT_MS);
    // 앱 셸은 '/' 하나만 보관한다. /place/* 같은 다른 페이지 응답으로 셸을 덮어쓰면 안 된다.
    if (res.ok && new URL(request.url).pathname === "/") cache.put("/", res.clone());
    return res;
  } catch {
    const cached = await cache.match("/", { ignoreSearch: true });
    if (cached) return cached;
    return new Response("오프라인입니다. 네트워크 연결 후 다시 시도해 주세요.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || update;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // 외부: Pretendard 폰트만 캐시 (Supabase·카카오 등은 건드리지 않음)
  if (url.origin !== self.location.origin) {
    if (url.hostname === FONT_HOST && url.pathname.includes("pretendard")) {
      event.respondWith(cacheFirst(request));
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) return; // 항상 네트워크

  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname === "/manifest.json" || url.pathname.startsWith("/icons/")) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
