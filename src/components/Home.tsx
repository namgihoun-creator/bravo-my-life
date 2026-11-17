"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Award,
  ChevronDown,
  Clock3,
  LocateFixed,
  MapPin,
  List,
  Map as MapIcon,
  Navigation,
  Plus,
  Siren,
  Store,
} from "lucide-react";
import {
  FALLBACK_LOCATION,
  FEEDBACK_CHIPS,
  FILTERS,
  ageTier,
  isVisiblePlace,
  matchesFilter,
  nearestParking,
  walkMinutes,
  yearsInBusiness,
  type Mode,
  type Place,
} from "@/data/places";
import { getSupabase } from "@/lib/supabase";
import { hasVoted, setVoted, subscribeVotes } from "@/lib/votes";
import LocationSheet, { type PickedLocation } from "./LocationSheet";
import ReportSheet from "./ReportSheet";
import PlaceMap from "./PlaceMap";

const RADIUS_M = 2000;
const EMPTY: Place[] = []; // 로딩 중 반환값을 안정된 참조로 유지 (지도 재그리기 방지)

type View = "list" | "map";

/* ───────────────────────── 위치 ───────────────────────── */

type Loc =
  | { kind: "pending" }
  | { kind: "gps" | "fallback" | "search"; name: string; lat: number; lng: number };

const FALLBACK: Loc = { kind: "fallback", ...FALLBACK_LOCATION };

function getGps(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 },
    );
  });
}

function LocationBadge({ loc, onClick }: { loc: Loc; onClick: () => void }) {
  const label =
    loc.kind === "pending" ? "위치 확인 중…" : loc.kind === "gps" ? "현재 위치 (GPS)" : loc.name;
  const Icon = loc.kind === "gps" ? LocateFixed : MapPin;
  return (
    <button
      onClick={onClick}
      aria-label={`동네 설정, 현재 ${label}`}
      aria-haspopup="dialog"
      className="theme-t inline-flex min-h-[44px] max-w-[180px] cursor-pointer items-center gap-1 rounded-full border border-line bg-surface pl-3 pr-2 text-caption font-semibold text-primary"
    >
      <Icon size={14} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      <ChevronDown size={14} className="shrink-0" aria-hidden />
    </button>
  );
}

/* ───────────────────────── 데이터 ───────────────────────── */

type Fetched = { key: string; places: Place[]; error: boolean };

function useNearby(loc: Loc, nonce: number) {
  const [result, setResult] = useState<Fetched | null>(null);
  const key = loc.kind === "pending" ? null : `${loc.lat},${loc.lng},${nonce}`;

  useEffect(() => {
    if (loc.kind === "pending" || !key) return;
    let cancelled = false;
    getSupabase()
      .rpc("bml_get_nearby_places", {
        p_lat: loc.lat,
        p_lng: loc.lng,
        p_radius_m: RADIUS_M,
        p_mode: null,
        p_limit: 300,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("bml_get_nearby_places", error);
        setResult({ key, places: error ? [] : ((data ?? []) as Place[]), error: !!error });
      });
    return () => {
      cancelled = true;
    };
  }, [loc, key]);

  const ready = result !== null && result.key === key;
  return {
    loading: !ready,
    error: ready && result.error,
    places: ready ? result.places : EMPTY,
  };
}

/* ───────────────────────── UI 조각 ───────────────────────── */

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tabs: { key: Mode; label: string; Icon: typeof Siren }[] = [
    { key: "survival", label: "긴급 생존 모드", Icon: Siren },
    { key: "nopo", label: "찐노포 탐색 모드", Icon: Store },
  ];
  return (
    <div
      role="tablist"
      aria-label="모드 전환"
      className="theme-t grid grid-cols-2 gap-1 rounded-[14px] border border-line bg-surface p-1"
    >
      {tabs.map(({ key, label, Icon }) => {
        const active = key === mode;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`theme-t flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-[10px] px-2 text-label font-bold ${
              active ? "bg-primary text-on-primary" : "bg-transparent text-muted"
            }`}
          >
            <Icon size={16} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const items = [
    { key: "list" as const, label: "목록", Icon: List },
    { key: "map" as const, label: "지도", Icon: MapIcon },
  ];
  return (
    <div
      role="group"
      aria-label="보기 방식"
      className="theme-t grid shrink-0 grid-cols-2 gap-0.5 rounded-[14px] border border-line bg-surface p-0.5"
    >
      {items.map(({ key, label, Icon }) => {
        const active = key === view;
        return (
          <button
            key={key}
            aria-pressed={active}
            onClick={() => onChange(key)}
            className={`theme-t flex min-h-[44px] w-[46px] cursor-pointer flex-col items-center justify-center rounded-xl text-caption font-bold ${
              active ? "bg-primary text-on-primary" : "bg-transparent text-muted"
            }`}
          >
            <Icon size={16} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function FilterChips({
  mode,
  value,
  counts,
  onChange,
}: {
  mode: Mode;
  value: string;
  /** 현재 반경 내 필터별 장소 수. null(로딩/오류)이면 모든 칩을 보여준다. */
  counts: Record<string, number> | null;
  onChange: (k: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 활성 칩이 가로 스크롤 영역 안쪽(중앙)으로 오도록 자동 스크롤
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [mode, value]);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="카테고리 필터"
      className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto"
    >
      {FILTERS[mode]
        .filter((f) => !counts || f.key === "all" || counts[f.key] > 0)
        .map((f) => {
        const active = f.key === value;
        return (
          <button
            key={f.key}
            aria-pressed={active}
            onClick={() => onChange(f.key)}
            className={`theme-t min-h-[44px] shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-4 text-label font-semibold ${
              active
                ? "border-primary bg-primary text-on-primary"
                : "border-line bg-surface text-ink"
            }`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

/** 원클릭 현장 피드백 칩: 누르면 즉시 +1(낙관적 업데이트) 후 `bml_update_feedback` RPC로 DB에 영구 저장 */
function FeedbackChip({
  placeId,
  chipKey,
  emoji,
  label,
  count,
}: {
  placeId: string;
  chipKey: string;
  emoji: string;
  label: string;
  count: number;
}) {
  const voteId = `${placeId}:${chipKey}`;
  // 투표 여부는 localStorage 스토어가 단일 진실: 이미 투표했으면 취소(-1)만, 아니면 +1만 가능
  const voted = useSyncExternalStore(
    subscribeVotes,
    () => hasVoted(voteId),
    () => false,
  );
  const [serverCount, setServerCount] = useState(count);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    const next = !voted;
    const delta = next ? 1 : -1;
    setPending(true);
    setVoted(voteId, next); // 요청 전에 먼저 잠금 저장
    setServerCount((c) => Math.max(0, c + delta));
    const { data, error } = await getSupabase().rpc("bml_update_feedback", {
      p_place_id: placeId,
      p_key: chipKey,
      p_delta: delta,
    });
    setPending(false);
    if (error) {
      console.error("bml_update_feedback", error);
      setVoted(voteId, !next);
      setServerCount((c) => Math.max(0, c - delta));
      return;
    }
    const fresh = (data as Record<string, number> | null)?.[chipKey];
    if (typeof fresh === "number") setServerCount(fresh);
  }

  return (
    <button
      aria-pressed={voted}
      aria-busy={pending}
      disabled={pending}
      aria-label={`${label} ${serverCount}명, ${voted ? "투표함 · 누르면 취소" : "누르면 추가"}`}
      onClick={toggle}
      className={`theme-t tnum inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-full border px-3 text-caption font-semibold active:scale-[0.97] disabled:cursor-wait ${
        voted ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink"
      }`}
    >
      <span aria-hidden>{emoji}</span>
      {label} {serverCount}
    </button>
  );
}

function PlaceCard({
  place,
  all,
  highlighted,
  onShowParking,
}: {
  place: Place;
  all: Place[];
  highlighted: boolean;
  onShowParking: (parkingId: string) => void;
}) {
  const near = nearestParking(place, all);
  const isSurvival = place.mode === "survival";
  const years = place.mode === "nopo" ? yearsInBusiness(place) : null;
  const tier = years !== null && years >= 10 ? ageTier(years) : null; // 업력 4단계 뱃지 색
  const BadgeIcon = isSurvival ? Clock3 : Award;
  const href = `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
  const dist = Math.round(place.distance_m);
  const chips = FEEDBACK_CHIPS[place.category] ?? [];

  return (
    <article
      id={`place-${place.id}`}
      className={`theme-t relative rounded-2xl border border-line bg-surface p-4 shadow-card ${
        isSurvival ? "border-l-4 border-l-primary" : ""
      } ${highlighted ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-title2 font-bold tracking-[-0.02em] text-ink">{place.name}</h2>
        {place.badge && (
          <span
            className={`theme-t inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-caption font-bold ${
              tier ? `age-badge age-badge-${tier}` : "bg-accent text-on-accent"
            }`}
          >
            <BadgeIcon size={12} aria-hidden />
            {tier ? `업력 ${years}년` : place.badge}
          </span>
        )}
      </div>

      <p className="tnum mt-1 text-distance font-extrabold tracking-[-0.02em] text-primary">
        도보 {walkMinutes(place.distance_m)}분
        <span className="ml-1.5 text-label font-semibold text-muted">· {dist}m</span>
      </p>

      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="핵심 스펙">
        {place.tags.slice(0, 3).map((t) => (
          <li
            key={t}
            className="theme-t rounded-full bg-tag-bg px-2.5 py-1 text-caption font-medium text-tag-text"
          >
            {t}
          </li>
        ))}
      </ul>

      <p className="mt-3 line-clamp-2 text-body text-ink">{place.summary}</p>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <FeedbackChip
              key={c.key}
              placeId={place.id}
              chipKey={c.key}
              emoji={c.emoji}
              label={c.label}
              count={place.feedback[c.key] ?? 0}
            />
          ))}
        </div>
      )}

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="theme-t mt-3 flex h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-cta text-label font-bold text-on-cta active:scale-[0.98]"
      >
        <Navigation size={16} aria-hidden />
        카카오맵 길찾기
      </a>

      {near && (
        <button
          onClick={() => onShowParking(near.parking.id)}
          className="theme-t mt-2 flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary bg-transparent px-3 text-label font-semibold text-primary active:scale-[0.98]"
        >
          <span aria-hidden>🅿️</span>
          인근 공영주차장 보기 · 도보 {near.walkMin}분
        </button>
      )}
    </article>
  );
}

function SkeletonCard() {
  return (
    <div
      className="h-[250px] animate-pulse rounded-2xl border border-line bg-surface p-4"
      aria-hidden
    >
      <div className="h-6 w-2/3 rounded bg-tag-bg" />
      <div className="mt-3 h-6 w-1/3 rounded bg-tag-bg" />
      <div className="mt-4 h-6 w-full rounded bg-tag-bg" />
      <div className="mt-4 h-12 w-full rounded-xl bg-tag-bg" />
    </div>
  );
}

/* ───────────────────────── 메인 ───────────────────────── */

export default function Home() {
  const [mode, setMode] = useState<Mode>("survival");
  const [filter, setFilter] = useState("all");
  const [loc, setLoc] = useState<Loc>({ kind: "pending" });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [view, setView] = useState<View>("list"); // 기본값: 목록
  const [selectedId, setSelectedId] = useState<string | null>(null); // 지도에서 고른 핀
  // scrollTargetId: 스크롤 이동 대상 / highlightId: 도착 후 링 강조 중인 카드
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const { loading, error, places: all } = useNearby(loc, nonce);

  // 최초 진입: GPS → 거부/실패 시 '부천역 인근' 폴백. 그 사이 사용자가 직접 고른 동네는 덮어쓰지 않는다.
  useEffect(() => {
    let cancelled = false;
    getGps().then((p) => {
      if (cancelled) return;
      setLoc((prev) =>
        prev.kind !== "pending"
          ? prev
          : p
            ? { kind: "gps", name: "현재 위치", ...p }
            : FALLBACK,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    // 상단 상태바/주소창 색도 모드 테마를 따라가게 한다 (DESIGN.md --primary)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", mode === "nopo" ? "#8a3b12" : "#0b5fff");
  }, [mode]);

  const requestGps = useCallback(async () => {
    const p = await getGps();
    if (!p) return false;
    setLoc({ kind: "gps", name: "현재 위치", ...p });
    return true;
  }, []);

  const pickLocation = (l: PickedLocation) => {
    setLoc({ kind: "search", ...l });
    setSheetOpen(false);
  };

  const changeMode = (m: Mode) => {
    setMode(m);
    setFilter("all");
    setSelectedId(null);
  };

  const changeFilter = (k: string) => {
    setFilter(k);
    setSelectedId(null);
  };

  const changeView = (v: View) => {
    setView(v);
    setSelectedId(null);
    if (v === "map") window.scrollTo({ top: 0 });
  };

  const showParking = (parkingId: string) => {
    setMode("survival");
    setFilter("parking");
    setHighlightId(null);
    if (view === "map") setSelectedId(parkingId); // 지도에서는 해당 주차장 핀을 선택
    else setScrollTargetId(parkingId);
  };

  // 목표 카드로 스크롤이 '도착한 뒤'에 링 강조를 시작한다.
  useEffect(() => {
    if (!scrollTargetId) return;
    const el = document.getElementById(`place-${scrollTargetId}`);
    if (!el) return;

    let started = false;
    let clearTimer: number | undefined;
    const startRing = () => {
      if (started) return;
      started = true;
      window.removeEventListener("scrollend", startRing);
      setHighlightId(scrollTargetId);
      clearTimer = window.setTimeout(() => setHighlightId(null), 2500);
    };

    window.addEventListener("scrollend", startRing);
    // 이미 화면 중앙이라 스크롤이 없거나 scrollend 미지원 브라우저 대비 폴백
    const fallback = window.setTimeout(startRing, 900);
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    return () => {
      window.removeEventListener("scrollend", startRing);
      window.clearTimeout(fallback);
      window.clearTimeout(clearTimer);
    };
  }, [scrollTargetId]);

  // 0건인 필터 칩은 숨기고, 선택돼 있던 필터가 0건이 되면 '전체'로 돌린다. (useMemo: 지도가 불필요하게 다시 그려지지 않게 참조 유지)
  const { counts, activeFilter, places } = useMemo(() => {
    // 노포 모드는 인허가 연도로 업력이 검증된 가게(10년+)와 유저 제보만 노출한다
    const modePlaces = all.filter((p) => p.mode === mode && isVisiblePlace(p));
    const counts =
      loading || error
        ? null
        : Object.fromEntries(
            FILTERS[mode].map((f) => [f.key, modePlaces.filter((p) => matchesFilter(p, f.key)).length]),
          );
    const activeFilter = counts && !counts[filter] ? "all" : filter;
    return {
      counts,
      activeFilter,
      places: modePlaces.filter((p) => matchesFilter(p, activeFilter)),
    };
  }, [all, mode, filter, loading, error]);

  const selected = places.find((p) => p.id === selectedId) ?? null;
  const center =
    loc.kind === "pending"
      ? null
      : { lat: loc.lat, lng: loc.lng, name: loc.kind === "gps" ? "현재 위치" : loc.name };

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md">
      <header className="px-4 pt-[max(20px,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-title1 font-extrabold tracking-[-0.03em] text-primary theme-t">
              Bravo My Life
            </h1>
            <p className="mt-0.5 text-label text-muted">내 손안의 동네 생존 &amp; 찐노포 가이드</p>
          </div>
          <LocationBadge loc={loc} onClick={() => setSheetOpen(true)} />
        </div>
      </header>

      <div className="theme-t sticky top-0 z-10 mt-4 space-y-3 bg-bg px-4 pb-3 pt-2 shadow-sticky">
        <ModeTabs mode={mode} onChange={changeMode} />
        <div className="flex items-center gap-2">
          <FilterChips mode={mode} value={activeFilter} counts={counts} onChange={changeFilter} />
          <ViewToggle view={view} onChange={changeView} />
        </div>
      </div>

      <main
        className="space-y-3 px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-4"
        aria-busy={loading}
      >
        {loading ? (
          view === "map" ? (
            <div className="h-[calc(100dvh-250px)] min-h-[380px] animate-pulse rounded-2xl bg-tag-bg" aria-hidden />
          ) : (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          )
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-body text-ink">데이터를 불러오지 못했어요.</p>
            <button
              onClick={() => setNonce((n) => n + 1)}
              className="mt-3 min-h-[44px] cursor-pointer rounded-xl bg-primary px-5 text-label font-bold text-on-primary"
            >
              다시 시도
            </button>
          </div>
        ) : view === "map" && center ? (
          <PlaceMap
            mode={mode}
            center={center}
            places={places}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onFallback={() => changeView("list")}
          >
            {selected && (
              <PlaceCard
                place={selected}
                all={all}
                highlighted={false}
                onShowParking={showParking}
              />
            )}
          </PlaceMap>
        ) : places.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-body text-muted">
              반경 2km 안에 조건에 맞는 장소가 아직 없어요.
            </p>
            <button
              onClick={() => setSheetOpen(true)}
              className="mt-3 min-h-[44px] cursor-pointer rounded-xl border border-primary px-5 text-label font-semibold text-primary"
            >
              다른 동네 보기
            </button>
            <button
              onClick={() => setReportOpen(true)}
              className="ml-2 mt-3 min-h-[44px] cursor-pointer rounded-xl border border-line px-5 text-label font-semibold text-ink"
            >
              장소 제보
            </button>
          </div>
        ) : (
          places.map((p) => (
            <PlaceCard
              key={p.id}
              place={p}
              all={all}
              highlighted={p.id === highlightId}
              onShowParking={showParking}
            />
          ))
        )}
        <div className="pt-2 text-center">
          <button
            onClick={() => setReportOpen(true)}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-full border border-primary px-4 text-label font-semibold text-primary"
          >
            <Plus size={16} aria-hidden />
            장소 제보
          </button>
          <p className="mt-2 text-caption text-muted">
            {mode === "nopo"
              ? "인허가 연도로 업력 10년 이상이 확인된 가게와 이웃 제보만 보여줘요."
              : "카카오 로컬 데이터 기반 · 영업시간·요금은 방문 전 확인해 주세요."}
          </p>
        </div>
      </main>

      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-40 mx-auto w-fit max-w-[90%] rounded-full bg-ink px-4 py-2.5 text-label font-semibold text-bg shadow-sticky"
        >
          {toast}
        </div>
      )}

      {reportOpen && (
        <ReportSheet
          defaultMode={mode}
          onClose={() => setReportOpen(false)}
          getPosition={getGps}
          onDone={() => {
            setReportOpen(false);
            setNonce((n) => n + 1); // 방금 제보한 장소가 목록에 반영되도록 다시 조회
            setToast("제보가 등록됐어요. 고마워요!");
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {sheetOpen && (
        <LocationSheet
          onClose={() => setSheetOpen(false)}
          onSelect={pickLocation}
          onUseGps={requestGps}
        />
      )}
    </div>
  );
}
