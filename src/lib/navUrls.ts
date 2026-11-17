/**
 * 길찾기 URL 생성 (순수 함수: React/브라우저 의존 없음 → 단독 테스트 가능).
 */
export type NavApp = "kakao" | "naver" | "tmap";
export type RouteMode = "car" | "walk";

export interface NavTarget {
  name: string;
  lat: number;
  lng: number;
  /** 장소 카테고리 (DB 값: parking 이면 자동차, 그 외 도보) */
  category?: string;
}

/** 출발지 = 앱의 현재 기준 위치 (GPS면 '내 위치', 선택한 동네/역이면 그 이름) */
export interface NavOrigin {
  lat: number;
  lng: number;
  label: string;
}

/** 공영주차장은 자동차, 그 외는 도보로 자동 선택 */
export function routeModeFor(category?: string): RouteMode {
  return category === "parking" || category === "공영주차장" ? "car" : "walk";
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

export function buildKakaoUrl({ name, lat, lng }: NavTarget): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`;
}

export function buildTmapUrl({ name, lat, lng }: NavTarget): string {
  return `tmap://route?goalname=${encodeURIComponent(name)}&goalx=${lng}&goaly=${lat}`;
}
