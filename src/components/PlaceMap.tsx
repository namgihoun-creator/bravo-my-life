"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinOff, RefreshCw, X } from "lucide-react";
import {
  loadKakaoMaps,
  mapErrorMessage,
  type KakaoMapsNS,
  type KClusterer,
  type KMap,
  type KMarker,
  type KOverlay,
} from "@/lib/kakaoMaps";
import { distanceM, type Mode, type Place } from "@/data/places";

interface Props {
  mode: Mode;
  center: { lat: number; lng: number; name: string };
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 지도를 쓸 수 없을 때 목록으로 돌아가는 버튼 */
  onFallback: () => void;
  /** '이 지역에서 다시 검색': 현재 지도 중심 좌표로 다시 조회 */
  onSearchHere: (center: { lat: number; lng: number }) => void;
  /** 선택된 장소의 상세 카드 (지도 하단에 오버레이) */
  children?: React.ReactNode;
}

type Status = "loading" | "ready" | "error";

const SEARCH_HERE_M = 200;
/** 코드가 지도를 움직인(맞춤·이동) 직후 이 시간 동안은 zoom_changed 를 사용자 조작으로 보지 않는다 */
const PROGRAMMATIC_MS = 900;

/**
 * 모드별 핀/클러스터 색 (DESIGN.md 토큰과 같은 값).
 * SVG data URI·클러스터 스타일은 CSS 변수를 못 쓰므로 상수로 둔다. 생존=파랑, 노포=갈색/앰버.
 */
const TONE = {
  survival: { fill: "#0b5fff", dot: "#ffd60a", text: "#ffffff" },
  nopo: { fill: "#8a3b12", dot: "#c8963e", text: "#fff8ec" },
} as const;

/** 클러스터 크기별 스타일 (calculator [10, 30, 100] → 4단계, 모두 44px 이상) */
function clusterStyles(mode: Mode): Record<string, string>[] {
  const t = TONE[mode];
  return [44, 52, 60, 68].map((size) => ({
    width: `${size}px`,
    height: `${size}px`,
    lineHeight: `${size - 6}px`, // border 3px*2 제외
    borderRadius: "50%",
    background: t.fill,
    color: t.text,
    border: "3px solid #ffffff",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    textAlign: "center",
    fontSize: size >= 60 ? "17px" : "15px",
    fontWeight: "800",
    cursor: "pointer",
  }));
}

/** 개별 핀 이미지: 44x48 투명 캔버스(터치 영역 확보) 하단 중앙에 물방울 핀 */
function pinImage(kakao: KakaoMapsNS, mode: Mode) {
  const t = TONE[mode];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="48" viewBox="0 0 44 48">` +
    `<path d="M22 46C22 46 8 31 8 20.5a14 14 0 0 1 28 0C36 31 22 46 22 46z" fill="${t.fill}" stroke="#fff" stroke-width="2.5"/>` +
    `<circle cx="22" cy="20.5" r="5" fill="${t.dot}"/></svg>`;
  return new kakao.MarkerImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    new kakao.Size(44, 48),
    { offset: new kakao.Point(22, 47) },
  );
}

/** 선택된 핀: 클러스터에 묶여 사라지지 않도록 별도 오버레이(앰버)로 항상 위에 표시. 44px 터치 영역. */
function selectedPinElement(place: Place, onClick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "map-pin-btn is-selected";
  btn.setAttribute("aria-label", `${place.name}, 도보 ${Math.round(place.distance_m)}m (선택됨)`);
  btn.innerHTML = `<span class="map-pin"><span class="map-pin-dot"></span></span>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function centerElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "map-me";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "기준 위치");
  el.innerHTML = `<span class="map-me-dot"></span><span class="map-me-label">기준 위치</span>`;
  return el;
}

export default function PlaceMap({
  mode,
  center,
  places,
  selectedId,
  onSelect,
  onFallback,
  onSearchHere,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KMap | null>(null);
  const kakaoRef = useRef<KakaoMapsNS | null>(null);
  const overlaysRef = useRef<KOverlay[]>([]);
  const programmaticAt = useRef(0);
  const markersRef = useRef<KMarker[]>([]);
  const clustererRef = useRef<KClusterer | null>(null);
  const onSelectRef = useRef(onSelect);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null); // 사용자가 드래그해 옮긴 지도 중심

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // 1) SDK 로드 + 지도 생성 (실패해도 앱은 계속 동작)
  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps()
      .then((kakao) => {
        if (cancelled || !containerRef.current) return;
        kakaoRef.current = kakao;
        const map = new kakao.Map(containerRef.current, {
          center: new kakao.LatLng(center.lat, center.lng),
          level: 5,
        });
        kakao.event.addListener(map, "click", () => onSelectRef.current(null)); // 지도 빈 곳 클릭 → 닫기
        // 사용자가 드래그를 끝내거나 줌을 바꾸면 지도 중심을 기억해, 조회 기준에서 200m 넘게 벗어났는지 계산한다
        const remember = () => {
          const c = map.getCenter();
          setMapCenter({ lat: c.getLat(), lng: c.getLng() });
        };
        kakao.event.addListener(map, "dragend", remember);
        kakao.event.addListener(map, "zoom_changed", () => {
          if (Date.now() - programmaticAt.current < PROGRAMMATIC_MS) return; // 장소 맞춤·핀 이동으로 생긴 줌 변화는 제외
          remember();
        });
        mapRef.current = map;
        setStatus("ready");
      })
      .catch((reason) => {
        if (cancelled) return;
        console.error("kakao maps", reason);
        setErrorMsg(mapErrorMessage(reason));
        setStatus("error");
      });
    return () => {
      cancelled = true;
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
      clustererRef.current?.clear();
      clustererRef.current = null;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      mapRef.current = null;
    };
    // 지도는 마운트당(또는 '다시 시도'당) 한 번만 만든다. 중심 이동은 아래 effect가 처리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // 2) 기준 위치 마커 + 핀(클러스터링) 그리기
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !kakao || !map) return;

    overlaysRef.current.forEach((o) => o.setMap(null));
    clustererRef.current?.clear();
    markersRef.current.forEach((m) => m.setMap(null));
    const overlays: KOverlay[] = [];

    overlays.push(
      new kakao.CustomOverlay({
        position: new kakao.LatLng(center.lat, center.lng),
        content: centerElement(),
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 1,
        map,
      }),
    );

    const selectedPlace = places.find((p) => p.id === selectedId);
    if (selectedPlace) {
      overlays.push(
        new kakao.CustomOverlay({
          position: new kakao.LatLng(selectedPlace.lat, selectedPlace.lng),
          content: selectedPinElement(selectedPlace, () => onSelectRef.current(selectedPlace.id)),
          xAnchor: 0.5,
          yAnchor: 1,
          zIndex: 10,
          clickable: true, // 핀 클릭이 지도 click(닫기)으로 번지지 않게
          map,
        }),
      );
    }

    // 나머지 핀: 겹치는 구역은 MarkerClusterer 가 숫자로 묶고, 클러스터를 누르거나 확대하면 개별 핀으로 펼쳐진다
    const image = pinImage(kakao, mode);
    const markers = places
      .filter((p) => p.id !== selectedId)
      .map((p) => {
        const marker = new kakao.Marker({
          position: new kakao.LatLng(p.lat, p.lng),
          image,
          title: `${p.name}, 도보 ${Math.round(p.distance_m)}m`,
          clickable: true,
        });
        kakao.event.addListener(marker, "click", () => onSelectRef.current(p.id));
        return marker;
      });

    if (kakao.MarkerClusterer) {
      clustererRef.current = new kakao.MarkerClusterer({
        map,
        markers,
        averageCenter: true,
        minLevel: 4, // 레벨 1~3(가까이 확대)에서는 개별 핀
        minClusterSize: 2,
        gridSize: 60,
        calculator: [10, 30, 100],
        styles: clusterStyles(mode),
      });
    } else {
      // libraries=clusterer 가 막혀도 핀은 보이게 한다
      clustererRef.current = null;
      markers.forEach((m) => m.setMap(map));
    }
    markersRef.current = markers;
    overlaysRef.current = overlays;
  }, [status, places, selectedId, mode, center.lat, center.lng]);

  // 3) 기준 위치/장소 목록이 바뀌면 전체가 보이게 맞춤
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !kakao || !map) return;
    programmaticAt.current = Date.now();
    map.relayout();
    if (places.length === 0) {
      map.setCenter(new kakao.LatLng(center.lat, center.lng));
      map.setLevel(5);
      return;
    }
    const bounds = new kakao.LatLngBounds();
    bounds.extend(new kakao.LatLng(center.lat, center.lng));
    for (const p of places) bounds.extend(new kakao.LatLng(p.lat, p.lng));
    map.setBounds(bounds, 60, 40, 60, 40);
  }, [status, places, center.lat, center.lng]);

  // 4) 핀을 고르면 상세 카드(하단)에 가리지 않도록 핀이 위쪽에 오게 이동
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !kakao || !map || !selectedId) return;
    const p = places.find((x) => x.id === selectedId);
    if (!p) return;
    const b = map.getBounds();
    const span = b.getNorthEast().getLat() - b.getSouthWest().getLat();
    programmaticAt.current = Date.now();
    map.panTo(new kakao.LatLng(p.lat - span * 0.22, p.lng));
    // places 변경 시 재이동하지 않도록 선택 변경에만 반응
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, status]);

  // 조회 기준 위치에서 200m 이상 벗어나면 '이 지역에서 다시 검색' 노출 (기준 위치가 바뀌면 자동으로 다시 계산)
  const movedFar =
    status === "ready" && mapCenter !== null && distanceM(center.lat, center.lng, mapCenter.lat, mapCenter.lng) >= SEARCH_HERE_M;

  // Esc 로 상세 카드 닫기
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSelectRef.current(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  return (
    <div className="relative h-[calc(100dvh-250px)] min-h-[380px] overflow-hidden rounded-2xl border border-line bg-tag-bg shadow-card">
      <div ref={containerRef} className="absolute inset-0" aria-label="장소 지도" />

      {status === "loading" && (
        <div
          className="absolute inset-0 flex items-center justify-center text-label text-muted"
          role="status"
        >
          지도를 불러오는 중…
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
          <MapPinOff size={32} className="text-muted" aria-hidden />
          <p className="text-body text-ink">{errorMsg}</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setStatus("loading");
                setAttempt((n) => n + 1);
              }}
              className="min-h-[44px] cursor-pointer rounded-xl border border-line px-4 text-label font-semibold text-ink"
            >
              다시 시도
            </button>
            <button
              onClick={onFallback}
              className="min-h-[44px] cursor-pointer rounded-xl bg-primary px-4 text-label font-bold text-on-primary"
            >
              목록으로 보기
            </button>
          </div>
        </div>
      )}

      {movedFar && mapCenter && (
        <button
          type="button"
          onClick={() => onSearchHere(mapCenter)}
          className="theme-t absolute left-1/2 top-3 z-20 flex min-h-[44px] -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border-2 border-surface bg-primary px-4 text-label font-bold text-on-primary shadow-sticky active:opacity-90"
        >
          <RefreshCw size={16} aria-hidden />
          이 지역에서 다시 검색
        </button>
      )}

      {status === "ready" && places.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-surface px-3 py-1.5 text-caption font-semibold text-muted shadow-card">
          이 조건에 맞는 장소가 반경 2km 안에 없어요
        </p>
      )}

      {children && (
        <div className="absolute inset-x-2 bottom-2 z-20 flex max-h-[70%] flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-label="상세 카드 닫기"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink shadow-card"
          >
            <X size={18} aria-hidden />
          </button>
          <div className="min-h-0 w-full overflow-y-auto rounded-2xl">{children}</div>
        </div>
      )}
    </div>
  );
}
