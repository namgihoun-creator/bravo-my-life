"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinOff } from "lucide-react";
import { loadKakaoMaps, mapErrorMessage, type KakaoMapsNS, type KMap, type KOverlay } from "@/lib/kakaoMaps";
import type { Place } from "@/data/places";

interface Props {
  center: { lat: number; lng: number; name: string };
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 지도를 쓸 수 없을 때 목록으로 돌아가는 버튼 */
  onFallback: () => void;
  /** 선택된 장소의 상세 카드 (지도 하단에 오버레이) */
  children?: React.ReactNode;
}

type Status = "loading" | "ready" | "error";

/** 핀 하나: 44px 터치 영역 버튼 안에 커스텀 핀. 색은 현재 모드의 테마 변수를 따른다(생존=파랑, 노포=갈색/앰버). */
function pinElement(place: Place, selected: boolean, onClick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `map-pin-btn${selected ? " is-selected" : ""}`;
  btn.setAttribute("aria-label", `${place.name}, 도보 ${Math.round(place.distance_m)}m`);
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

export default function PlaceMap({ center, places, selectedId, onSelect, onFallback, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KMap | null>(null);
  const kakaoRef = useRef<KakaoMapsNS | null>(null);
  const overlaysRef = useRef<KOverlay[]>([]);
  const onSelectRef = useRef(onSelect);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [attempt, setAttempt] = useState(0);

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
      mapRef.current = null;
    };
    // 지도는 마운트당 한 번만 만든다 (중심 이동은 아래 effect가 처리)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // 2) 핀 + 기준 위치 마커 그리기 (장소/선택이 바뀔 때)
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !kakao || !map) return;

    overlaysRef.current.forEach((o) => o.setMap(null));
    const next: KOverlay[] = [];

    next.push(
      new kakao.CustomOverlay({
        position: new kakao.LatLng(center.lat, center.lng),
        content: centerElement(),
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 1,
        map,
      }),
    );
    for (const p of places) {
      const selected = p.id === selectedId;
      next.push(
        new kakao.CustomOverlay({
          position: new kakao.LatLng(p.lat, p.lng),
          content: pinElement(p, selected, () => onSelectRef.current(p.id)),
          xAnchor: 0.5,
          yAnchor: 1,
          zIndex: selected ? 10 : 2,
          clickable: true, // 핀 클릭이 지도 click(닫기)으로 번지지 않게
          map,
        }),
      );
    }
    overlaysRef.current = next;
  }, [status, places, selectedId, center.lat, center.lng]);

  // 3) 기준 위치/장소 목록이 바뀌면 전체가 보이게 맞춤
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !kakao || !map) return;
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
    map.panTo(new kakao.LatLng(p.lat - span * 0.22, p.lng));
    // places 변경 시 재이동하지 않도록 선택 변경에만 반응
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, status]);

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
        <div className="absolute inset-0 flex items-center justify-center text-label text-muted" role="status">
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

      {status === "ready" && places.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-surface px-3 py-1.5 text-caption font-semibold text-muted shadow-card">
          이 조건에 맞는 장소가 반경 2km 안에 없어요
        </p>
      )}

      {children && (
        <div className="absolute inset-x-2 bottom-2 z-20 max-h-[66%] overflow-y-auto rounded-2xl">{children}</div>
      )}
    </div>
  );
}
