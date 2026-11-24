import type { NextRequest } from "next/server";

/**
 * API 라우트 공용 가드(동일 출처 확인·IP·시간당 횟수 제한·입력 정리·한국 좌표 범위·카카오 호출).
 * `/api/places/report`, `/api/area-requests`, `/api/geocode` 가 함께 쓴다. 키는 서버 환경 변수에서만 읽는다.
 */

/** 같은 출처에서 온 요청인가(Origin 헤더가 있을 때만 host 와 비교, 없으면 통과) */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/**
 * IP별 시간당 횟수 제한(서버 메모리). 서버리스에서는 인스턴스마다 따로 세므로 best-effort 방어선이다.
 * 반환 함수가 true 면 제한 초과다. 호출 시점의 시각을 기록한다.
 */
export function createRateLimiter(limit: number, windowMs = 60 * 60 * 1000) {
  const hits = new Map<string, number[]>();
  return function rateLimited(ip: string): boolean {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(ip, recent);
      return true;
    }
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.clear();
    return false;
  };
}

/** 제어문자·태그 제거, 공백 정리 */
export function clean(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function inKorea(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

/** 카카오 로컬 API GET(서버 전용 키). 실패하면 던진다. */
export async function kakaoJson(url: string, key: string) {
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000), // 카카오가 응답하지 않아도 서버 함수가 매달리지 않게
  });
  if (!res.ok) throw new Error(`kakao ${res.status}`);
  return res.json();
}
