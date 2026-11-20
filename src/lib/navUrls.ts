/**
 * 길찾기 URL 생성 (순수 함수: React/브라우저 의존 없음 → 단독 테스트 가능).
 */
export type NavApp = "kakao" | "naver" | "tmap";
export type RouteMode = "car" | "walk";

export interface NavTarget {
  name: string;
  lat: number;
  lng: number;
  /** 장소 카테고리 (DB 값: parking·carwash 면 자동차, 그 외 도보) */
  category?: string;
}

/** 출발지 = 앱의 현재 기준 위치 (GPS면 '내 위치', 선택한 동네/역이면 그 이름) */
export interface NavOrigin {
  lat: number;
  lng: number;
  label: string;
}

/** 공영주차장·세차장은 자동차, 그 외는 도보로 자동 선택 */
export function routeModeFor(category?: string): RouteMode {
  return category === "parking" || category === "공영주차장" || category === "carwash" || category === "세차장" ? "car" : "walk";
}

const DEFAULT_APP_NAME = "bravo-mylife.vercel.app";

/** 네이버지도 앱 스킴. 출발지를 넘기지 않으면 앱이 '내 위치'를 출발지로 자동 설정한다. */
export function buildNaverAppUrl(target: NavTarget, appName: string = DEFAULT_APP_NAME): string {
  const mode = routeModeFor(target.category);
  return (
    `nmap://route/${mode}?dlat=${target.lat}&dlng=${target.lng}` +
    `&dname=${encodeURIComponent(target.name)}&appname=${encodeURIComponent(appName)}`
  );
}

/** 네이버지도 웹 경로(최신 통합 경로). 출발지가 있으면 채워서 열고, 없으면 비워 둔다('-'). */
export function buildNaverWebUrl(target: NavTarget, origin?: NavOrigin): string {
  const mode = routeModeFor(target.category);
  const start = origin
    ? `${origin.lng},${origin.lat},${encodeURIComponent(origin.label)}`
    : "-";
  return `https://map.naver.com/p/directions/${start}/-/${target.lng},${target.lat},${encodeURIComponent(target.name)}/-/${mode}`;
}

/**
 * 네이버 장소 검색어: `구(또는 시·군) + 상호명`. 도로명주소 전체는 네이버 등록 표기와 달라 결과가 비는 일이 많아 쓰지 않는다.
 * 주소 앞 3토큰에서 '○○구'를 찾고(수원시 팔달구 → 팔달구), 없으면 두 번째 토큰(시·군)을 쓴다. 주소가 없으면 상호명만.
 */
export function naverSearchQuery(name: string, address?: string | null): string {
  const tokens = (address ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
  const gu = tokens.find((t, i) => i > 0 && /[가-힣]구$/.test(t));
  const area = gu ?? (tokens[1] && /[가-힣][시군]$/.test(tokens[1]) ? tokens[1] : "");
  return `${area} ${name}`.trim();
}

/** 네이버지도 앱 통합검색(`nmap://search`는 query·appname 만 받는다 — 좌표 파라미터 없음) */
export function buildNaverSearchAppUrl(query: string, appName: string = DEFAULT_APP_NAME): string {
  return `nmap://search?query=${encodeURIComponent(query)}&appname=${encodeURIComponent(appName)}`;
}

/** 네이버지도 웹 검색(앱이 없을 때의 폴백) */
export function buildNaverSearchWebUrl(query: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

/**
 * 전화 걸기 링크: 숫자·하이픈만 허용하고 9~11자리일 때만 만든다(그 외 형식은 버튼을 숨긴다).
 * 010 등 휴대폰 번호는 개인 번호일 수 있고 상세 페이지는 검색 엔진에 색인되므로 노출하지 않는다(유선·대표번호만).
 */
export function telHref(phone: string | null | undefined): string | null {
  const p = (phone ?? "").trim();
  if (!/^[0-9][0-9-]*$/.test(p)) return null;
  const digits = p.replace(/-/g, "");
  if (/^01[016789]/.test(digits)) return null;
  return digits.length >= 9 && digits.length <= 11 ? `tel:${digits}` : null;
}

/** 카카오맵 장소 페이지: 검색이 아니라 장소 하나를 정확히 가리킨다(숫자 id 만 허용) */
export function buildKakaoPlaceUrl(kakaoId: string | null | undefined): string | null {
  return kakaoId && /^\d{1,20}$/.test(kakaoId) ? `https://place.map.kakao.com/${kakaoId}` : null;
}

export function buildKakaoUrl({ name, lat, lng }: NavTarget): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`;
}

export function buildTmapUrl({ name, lat, lng }: NavTarget): string {
  return `tmap://route?goalname=${encodeURIComponent(name)}&goalx=${lng}&goaly=${lat}`;
}
