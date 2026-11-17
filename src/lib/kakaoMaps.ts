/**
 * 카카오맵 JS SDK 로더 + 필요한 최소 타입.
 * - 키 누락, 도메인 미등록(스크립트 로드 거부), 네트워크 오류, 로드 지연 모두 reject 로 돌려 앱이 멈추지 않게 한다.
 * - 실패한 뒤에는 캐시를 비워 '다시 시도'가 가능하다.
 */

export interface KLatLng {
  getLat(): number;
  getLng(): number;
}
export interface KBounds {
  extend(p: KLatLng): void;
  getSouthWest(): KLatLng;
  getNorthEast(): KLatLng;
}
export interface KMap {
  setCenter(p: KLatLng): void;
  panTo(p: KLatLng): void;
  setLevel(level: number): void;
  setBounds(b: KBounds, top?: number, right?: number, bottom?: number, left?: number): void;
  getBounds(): KBounds;
  relayout(): void;
}
export interface KOverlay {
  setMap(map: KMap | null): void;
}
export interface KMarker {
  setMap(map: KMap | null): void;
}
export interface KSize {
  readonly __size?: never;
}
export interface KPoint {
  readonly __point?: never;
}
export interface KMarkerImage {
  readonly __img?: never;
}
export interface KClusterer {
  clear(): void;
}

export interface KakaoMapsNS {
  load(cb: () => void): void;
  Map: new (el: HTMLElement, opts: { center: KLatLng; level: number }) => KMap;
  LatLng: new (lat: number, lng: number) => KLatLng;
  LatLngBounds: new () => KBounds;
  CustomOverlay: new (opts: {
    position: KLatLng;
    content: HTMLElement | string;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
    clickable?: boolean;
    map?: KMap;
  }) => KOverlay;
  Size: new (w: number, h: number) => KSize;
  Point: new (x: number, y: number) => KPoint;
  MarkerImage: new (src: string, size: KSize, opts?: { offset?: KPoint }) => KMarkerImage;
  Marker: new (opts: {
    position: KLatLng;
    image?: KMarkerImage;
    title?: string;
    clickable?: boolean;
    zIndex?: number;
  }) => KMarker;
  /** libraries=clusterer 가 로드돼야 존재한다 (없으면 개별 마커로 폴백) */
  MarkerClusterer?: new (opts: {
    map: KMap;
    markers?: KMarker[];
    averageCenter?: boolean;
    minLevel?: number;
    minClusterSize?: number;
    gridSize?: number;
    disableClickZoom?: boolean;
    calculator?: number[];
    styles?: Record<string, string>[];
  }) => KClusterer;
  event: {
    addListener(target: KMap | KMarker, type: string, handler: () => void): void;
  };
}

declare global {
  interface Window {
    kakao?: { maps?: KakaoMapsNS };
  }
}

export type MapLoadError = "NO_KEY" | "LOAD_FAILED" | "TIMEOUT";

const TIMEOUT_MS = 8000;
let pending: Promise<KakaoMapsNS> | null = null;

export function loadKakaoMaps(): Promise<KakaoMapsNS> {
  if (typeof window === "undefined") return Promise.reject<KakaoMapsNS>("LOAD_FAILED");
  const existing = window.kakao?.maps;
  if (existing?.Map) return Promise.resolve(existing);
  if (pending) return pending;

  const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
  if (!key) return Promise.reject<KakaoMapsNS>("NO_KEY");

  pending = new Promise<KakaoMapsNS>((resolve, reject) => {
    const fail = (reason: MapLoadError, script?: HTMLScriptElement) => {
      pending = null;
      script?.remove();
      reject(reason);
    };

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=clusterer`;
    script.async = true;

    const timer = window.setTimeout(() => fail("TIMEOUT", script), TIMEOUT_MS);
    script.onload = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        window.clearTimeout(timer);
        return fail("LOAD_FAILED", script);
      }
      try {
        maps.load(() => {
          window.clearTimeout(timer);
          resolve(maps);
        });
      } catch {
        window.clearTimeout(timer);
        fail("LOAD_FAILED", script);
      }
    };
    // 도메인 미등록·잘못된 키면 SDK 요청이 거부되어 onerror 로 들어온다
    script.onerror = () => {
      window.clearTimeout(timer);
      fail("LOAD_FAILED", script);
    };
    document.head.appendChild(script);
  });
  return pending;
}

export function mapErrorMessage(reason: unknown): string {
  if (reason === "NO_KEY") return "지도 키가 설정되지 않았어요.";
  if (reason === "TIMEOUT") return "지도를 불러오는 데 너무 오래 걸려요.";
  return "지도를 불러오지 못했어요. (카카오 개발자 콘솔에 이 사이트 도메인이 등록돼 있어야 해요.)";
}
