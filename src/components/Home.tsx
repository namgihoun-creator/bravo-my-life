"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Award,
  ChevronDown,
  HeartHandshake,
  TriangleAlert,
  ChevronRight,
  Heart,
  LocateFixed,
  MapPin,
  Search,
  X,
  List,
  Map as MapIcon,
  Plus,
  Share2,
  Siren,
  Store,
  UtensilsCrossed,
} from "lucide-react";
import {
  FALLBACK_LOCATION,
  FEEDBACK_CHIPS,
  FILTERS,
  ageTier,
  distanceM,
  feeEntries,
  feedbackCount,
  fieldInfo,
  placeMeta,
  syncedLabel,
  foodLabel,
  isVisiblePlace,
  matchesFilter,
  matchesQuery,
  nearestParking,
  walkMinutes,
  yearsInBusiness,
  type Mode,
  type Place,
  type PlaceFeedback,
} from "@/data/places";
import { toggleFavorite, useFavorites } from "@/lib/favorites";
import { pushFavorite, pushVisited, useCouple } from "@/lib/couple";
import { cleanNote, NOTE_MAX, removeVisited, setVisited, useVisited } from "@/lib/visited";
import CoupleSheet from "@/components/CoupleSheet";
import HScroll from "@/components/HScroll";
import Link from "next/link";
import AddressLine from "@/components/AddressLine";
import { getOpenState } from "@/lib/openStatus";
import { sharePlace } from "@/lib/share";
import { readNearby, saveNearby } from "@/lib/placeCache";
import { getSupabase } from "@/lib/supabase";
import { useMinuteClock } from "@/lib/useMinuteClock";
import { hasVoted, setVoted, subscribeVotes } from "@/lib/votes";
import CategoryIcon from "@/components/CategoryIcon";
import InstallBar from "@/components/InstallApp";
import LocationSheet, { type PickedLocation } from "./LocationSheet";
import ReportSheet from "./ReportSheet";
import IssueReportSheet from "./IssueReportSheet";
import { rememberMode, resolveStartMode } from "@/lib/startMode";
import PlaceMap from "./PlaceMap";
import NavigationButton from "./NavigationButton";
import type { NavOrigin } from "@/lib/navigation";
import { showToast } from "@/lib/toast";

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
  // 440px 미만에서는 아이콘만(44×44) 보여 제목·돋보기·커플 버튼과 한 줄에 겹침 없이 들어가게 한다. 이름은 aria-label/title 로 유지.
  return (
    <button
      onClick={onClick}
      aria-label={`동네 설정, 현재 ${label}`}
      title={label}
      aria-haspopup="dialog"
      className="theme-t inline-flex min-h-[44px] min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 rounded-full border border-line bg-surface pl-3 pr-2 text-caption font-semibold text-primary max-[439px]:w-11 max-[439px]:justify-center max-[439px]:gap-0 max-[439px]:px-0"
    >
      <Icon size={14} className="shrink-0 max-[439px]:size-[18px]" aria-hidden />
      <span className="truncate max-[439px]:hidden">{loc.kind === "gps" ? "현재 위치" : label}</span>
      <ChevronDown size={14} className="shrink-0 max-[439px]:hidden" aria-hidden />
    </button>
  );
}

/* ───────────────────────── 데이터 ───────────────────────── */

/** staleAt: 네트워크 실패/오프라인으로 캐시를 대신 보여주는 경우 그 캐시의 저장 시각(ms) */
type Fetched = { key: string; places: Place[]; error: boolean; staleAt: number | null };

const FETCH_TIMEOUT_MS = 10_000;

/** '주변 주차장' 기준점(노포). 이 좌표 반경 500m(0건이면 800m) 안의 공영주차장을 가게 기준 거리순으로 보여준다. */
interface Anchor {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** 돌아갈 때 복원할 노포 모드 필터 */
  returnFilter: string;
}

const ANCHOR_RADII = [500, 800];

/** 목록 한 번에 그리는 카드 수 */
const PAGE_SIZE = 30;

function useAnchorParking(anchor: Anchor | null, nonce: number) {
  const [res, setRes] = useState<{ key: string; places: Place[]; radius: number; error: boolean } | null>(null);
  const lat = anchor?.lat;
  const lng = anchor?.lng;
  const key = lat === undefined || lng === undefined ? null : `${lat},${lng},${nonce}`;

  useEffect(() => {
    if (!key || lat === undefined || lng === undefined) return;
    let cancelled = false;
    const ctrl = new AbortController();
    const query = async (radius: number) => {
      const { data, error } = await getSupabase()
        .rpc("bml_get_nearby_places", { p_lat: lat, p_lng: lng, p_radius_m: radius, p_mode: "survival", p_limit: 300 })
        .abortSignal(ctrl.signal);
      if (error) throw error;
      return ((data ?? []) as Place[]).filter((p) => p.category === "parking"); // RPC는 가게 기준 거리순
    };
    (async () => {
      try {
        let radius = ANCHOR_RADII[0];
        let places = await query(radius);
        if (places.length === 0) {
          radius = ANCHOR_RADII[1];
          places = await query(radius);
        }
        if (!cancelled) setRes({ key, places, radius, error: false });
      } catch (e) {
        if (!cancelled) {
          console.error("anchor parking", e);
          setRes({ key, places: [], radius: ANCHOR_RADII[0], error: true });
        }
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [key, lat, lng]);

  const ready = key !== null && res !== null && res.key === key;
  return {
    loading: key !== null && !ready,
    error: ready && res.error,
    places: ready ? res.places : EMPTY,
    radius: ready ? res.radius : ANCHOR_RADII[0],
  };
}

function useNearby(loc: Loc, nonce: number, refresh: number) {
  const [result, setResult] = useState<Fetched | null>(null);
  const loadedKey = useRef<string | null>(null); // 마지막으로 성공적으로 불러온 key
  const key = loc.kind === "pending" ? null : `${loc.lat},${loc.lng},${nonce}`;

  useEffect(() => {
    if (loc.kind === "pending" || !key) return;
    let cancelled = false;
    const ctrl = new AbortController();
    const { lat, lng } = loc;
    // 이미 이 위치의 데이터가 화면에 있으면(조용한 새로고침) 실패해도 지금 화면을 그대로 둔다
    const silent = loadedKey.current === key;

    // 오프라인·타임아웃·실패 시: 직전 조회 캐시(3km 이내)가 있으면 에러 대신 그것을 보여준다
    const fallback = () => {
      if (cancelled || silent) return;
      const cached = readNearby(lat, lng);
      setResult(
        cached
          ? { key, places: cached.places, error: false, staleAt: cached.t }
          : { key, places: [], error: true, staleAt: null },
      );
    };

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      fallback();
      return;
    }

    const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    // 모드별로 따로 조회해 한쪽(예: 노포 수백 곳)이 limit을 먼저 채워 다른 쪽이 잘리지 않게 한다
    const supabase = getSupabase();
    const fetchMode = (m: Mode) =>
      supabase
        .rpc("bml_get_nearby_places", { p_lat: lat, p_lng: lng, p_radius_m: RADIUS_M, p_mode: m, p_limit: 400 })
        .abortSignal(ctrl.signal);
    Promise.all([fetchMode("survival"), fetchMode("nopo")])
      .then(([sv, np]) => {
        window.clearTimeout(timer);
        if (cancelled) return;
        const error = sv.error ?? np.error;
        if (error) {
          console.error("bml_get_nearby_places", error);
          return fallback();
        }
        const places = [...((sv.data ?? []) as Place[]), ...((np.data ?? []) as Place[])];
        saveNearby(lat, lng, places);
        loadedKey.current = key;
        setResult({ key, places, error: false, staleAt: null });
      })
      .then(undefined, (e) => {
        window.clearTimeout(timer);
        console.error("bml_get_nearby_places", e);
        fallback();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [loc, key, refresh]);

  const ready = result !== null && result.key === key;
  return {
    loading: !ready,
    error: ready && result.error,
    places: ready ? result.places : EMPTY,
    staleAt: ready ? result.staleAt : null,
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
            className={`theme-t flex min-h-[44px] min-w-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-2 text-label font-bold max-[359px]:gap-1 max-[359px]:px-1 max-[359px]:text-[13px] ${
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
      className="theme-t grid shrink-0 grid-cols-2 gap-px rounded-[14px] border border-line bg-surface p-px"
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

/** 0건이어도 칩을 숨기지 않는 핵심 카테고리 */
const CORE_SURVIVAL_KEYS = ["toilet", "parking", "carwash"];
const isCoreChip = (mode: Mode, key: string) => mode === "survival" && CORE_SURVIVAL_KEYS.includes(key);

const EMPTY_MESSAGE: Record<string, string> = {
  toilet: "반경 내 등록된 개방화장실이 없어요. 지도를 넓혀 다시 찾아보세요",
  parking: "반경 내 등록된 공영주차장이 없어요. 지도를 넓혀 다시 찾아보세요",
  carwash: "반경 내 등록된 세차장이 없어요. 지도를 넓혀 다시 찾아보세요",
};

function FilterChips({
  mode,
  value,
  counts,
  favCount,
  visitedCount,
  onChange,
  showOpenChip,
  openOnly,
  onToggleOpen,
}: {
  mode: Mode;
  value: string;
  /** 현재 반경 내 필터별 장소 수. null(로딩/오류)이면 모든 칩을 보여준다. */
  counts: Record<string, number> | null;
  /** 이 모드에서 찜한 장소 수 (1 이상이면 '찜 N') */
  favCount: number;
  /** 이 모드에서 '다녀옴' 체크인한 장소 수 (1 이상일 때만 칩을 보인다) */
  visitedCount: number;
  onChange: (k: string) => void;
  /** 영업시간이 확인된 장소가 있을 때만 '지금 영업 중' 칩을 보여준다 */
  showOpenChip: boolean;
  /** '지금 영업 중 / 지금 이용 가능(24시)' 토글 */
  openOnly: boolean;
  onToggleOpen: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 활성 카테고리 칩이 가로 스크롤 영역 안쪽(중앙)으로 오도록 자동 스크롤
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[data-filter-chip][aria-pressed="true"]')
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [mode, value]);

  // '찜' 칩은 0건이어도 항상 보인다(발견 가능성). 나머지는 0건이면 숨긴다.
  // 생존 모드 핵심 카테고리(개방화장실·공영주차장)는 0건이어도 칩을 보여 주고, 눌렀을 때 안내 문구를 띄운다.
  const chips = FILTERS[mode].filter(
    (f) => !counts || f.key === "all" || f.key === "fav" || isCoreChip(mode, f.key) || counts[f.key] > 0,
  );
  const openLabel = mode === "survival" ? "지금 이용 가능(24시)" : "지금 영업 중";

  // 모든 칩이 같은 버튼 규격(아이콘 14px + gap-1.5 + 텍스트, 활성 시 currentColor 상속)을 쓴다
  const chip = (key: string, active: boolean, onClick: () => void, label: string, fill = false) => (
    <button
      key={key}
      data-filter-chip
      aria-pressed={active}
      onClick={onClick}
      className={`theme-t inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-label font-semibold ${
        active ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink"
      }`}
    >
      <CategoryIcon k={key} fill={fill} />
      {label}
    </button>
  );

  const openChip = chip("open-now", openOnly, onToggleOpen, openLabel);

  const items = chips.map((f) =>
    chip(
      f.key,
      f.key === value,
      () => onChange(f.key),
      f.key === "fav" ? (favCount > 0 ? `찜 ${favCount}` : "찜") : f.label,
      f.key === "fav" && favCount > 0,
    ),
  );
  // 순서: 전체 · 찜 · 지금 영업 중 · 카테고리/연차
  // 순서: 전체 · 찜 · (다녀옴) · (지금 영업 중) · 카테고리/연차/업종
  if (visitedCount > 0) {
    items.splice(
      Math.min(2, items.length),
      0,
      chip("visited", value === "visited", () => onChange("visited"), `다녀옴 ${visitedCount}`),
    );
  }
  if (showOpenChip) items.splice(Math.min(visitedCount > 0 ? 3 : 2, items.length), 0, openChip);

  return (
    <HScroll scrollRef={ref} ariaLabel="카테고리 필터">
      {items}
    </HScroll>
  );
}

/** 원클릭 현장 피드백 칩: 누르면 즉시 +1(낙관적 업데이트) 후 `bml_update_feedback` RPC로 DB에 영구 저장 */
function FeedbackChip({
  placeId,
  chipKey,
  icon,
  label,
  count,
}: {
  placeId: string;
  chipKey: string;
  icon: string;
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
      className={`theme-t tnum inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-caption font-semibold active:scale-[0.97] disabled:cursor-wait ${
        voted ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink"
      }`}
    >
      <CategoryIcon k={icon} />
      {label} {serverCount}
    </button>
  );
}

function PlaceCard({
  place,
  all,
  highlighted,
  onShowParking,
  onAnchorParking,
  anchorName,
  nowMs,
  origin,
  onReportIssue,
}: {
  place: Place;
  all: Place[];
  highlighted: boolean;
  onShowParking: (parkingId: string) => void;
  /** 노포 카드 '주변 주차장': 이 가게를 기준점으로 주변 공영주차장 보기 */
  onAnchorParking: (place: Place) => void;
  /** 기준점(노포) 이름: 있으면 거리를 '가게에서 도보 N분'으로 표시 */
  anchorName?: string;
  /** 현재 시각(ms, 분 단위). 영업 중 상태 점 표시에 쓴다. */
  nowMs: number;
  /** 길찾기 출발지(현재 기준 위치). 네이버지도 웹 경로의 출발지 입력에 쓴다. */
  origin?: NavOrigin;
  /** '정보 오류 제보' 바텀 시트 열기 */
  onReportIssue: (place: Place) => void;
}) {
  const near = nearestParking(place, all);
  const open = nowMs > 0 ? getOpenState(place, nowMs) : null;
  const isSurvival = place.mode === "survival";
  const years = place.mode === "nopo" ? yearsInBusiness(place) : null;
  const tier = years !== null && years >= 10 ? ageTier(years) : null; // 업력 4단계 뱃지 색
  const dist = Math.round(place.distance_m);
  const chips = FEEDBACK_CHIPS[place.category] ?? [];
  const food = place.mode === "nopo" ? foodLabel(place) : null; // 상호만 보고도 무슨 식당인지 알 수 있게
  const fees = place.category === "parking" ? feeEntries(place) : []; // 주차 요금·무료 개방
  const meta = placeMeta(place);
  const showMeta = place.category === "carwash" || place.category === "toilet";
  const fav = !!useFavorites()[place.id];
  const visitedEntry = useVisited()[place.id];
  const [editing, setEditing] = useState(false); // 한 줄 메모 입력·수정 영역
  const [draft, setDraft] = useState("");
  const info = fieldInfo(place);
  const hasField = info.closedDays.length > 0 || !!info.hours || !!info.breakTime;
  const statusRow = !!open?.status || !!open?.reason;

  return (
    <article
      id={`place-${place.id}`}
      className={`theme-t relative rounded-2xl border border-line bg-surface p-4 shadow-card ${
        isSurvival ? "border-l-4 border-l-primary" : ""
      } ${highlighted ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-title2 font-bold tracking-[-0.02em] text-ink [overflow-wrap:anywhere]">
          {place.mode === "nopo" ? (
            // 상세 페이지가 있는 노포만 링크. 줄 높이가 작아 -my-2.5/py-2.5 로 터치 영역만 44px 이상으로 넓힌다(카드 높이 불변).
            <Link
              href={`/place/${place.id}`}
              prefetch={false}
              aria-label={`${place.name} 상세 보기`}
              className="-my-2.5 inline-block py-2.5 active:opacity-70"
            >
              {place.name}
              <ChevronRight size={16} strokeWidth={2} className="ml-0.5 inline-block align-[-2px] text-muted" aria-hidden />
            </Link>
          ) : (
            place.name
          )}
        </h2>
        {place.badge && (
          <span
            className={`theme-t inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-caption font-bold ${
              tier ? `age-badge age-badge-${tier}` : "bg-accent text-on-accent"
            }`}
          >
            {isSurvival ? <CategoryIcon k={place.category} size={12} /> : <Award size={12} strokeWidth={2} aria-hidden />}
            {tier ? `업력 ${years}년` : place.badge}
          </span>
        )}
      </div>

      {place.reported_issue && (
        <p
          role="status"
          className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-lg border border-warning bg-surface px-2 py-1 text-caption font-bold text-warning"
        >
          <TriangleAlert size={12} strokeWidth={2} className="shrink-0" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">폐업·변경 제보됨</span>
        </p>
      )}

      {food && (
        <p className="mt-0.5 flex items-center gap-1 text-label font-semibold text-muted">
          <UtensilsCrossed size={14} className="shrink-0" aria-hidden />
          {food}
        </p>
      )}

      <p className="tnum mt-1 text-distance font-extrabold tracking-[-0.02em] text-primary">
        {anchorName && (
          <span className="text-label font-semibold text-muted [overflow-wrap:anywhere]">{anchorName}에서 </span>
        )}
        도보 {walkMinutes(place.distance_m)}분
        <span className="ml-1.5 text-label font-semibold text-muted">
          · {dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${dist}m`}
        </span>
      </p>

      {place.mode === "nopo" && place.address && <AddressLine address={place.address} />}

      {fees.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="주차 요금">
          {fees.map((f) => (
            <li
              key={f.text}
              className={`rounded-lg px-2.5 py-1 text-label font-bold ${
                f.free ? "border border-success text-success" : "bg-accent text-on-accent"
              }`}
            >
              {f.free ? (f.text === "무료" ? "무료 주차장" : f.text) : `요금 ${f.text}`}
            </li>
          ))}
        </ul>
      )}

      {showMeta && ((meta.type && meta.type !== "세차장") || meta.hours || meta.closed || meta.facilities.length > 0) && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="이용 정보">
          {meta.type && meta.type !== "세차장" && place.category === "carwash" && (
            <li className="rounded-lg bg-accent px-2.5 py-1 text-label font-bold text-on-accent">{meta.type}</li>
          )}
          {meta.hours && (
            <li className="tnum rounded-lg border border-line bg-bg px-2.5 py-1 text-label font-bold text-ink">
              {place.category === "toilet" ? "개방" : "운영"} {meta.hours}
            </li>
          )}
          {meta.closed && info.closedDays.length === 0 && (
            <li className="rounded-lg border border-danger px-2.5 py-1 text-label font-bold text-danger">
              휴무 {meta.closed}
            </li>
          )}
          {meta.facilities.map((f) => (
            <li key={f} className="rounded-lg border border-line px-2.5 py-1 text-label font-semibold text-muted">
              {f}
            </li>
          ))}
        </ul>
      )}

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

      {open?.status ? (
        <p className="mt-3 flex min-w-0 items-center gap-1.5 text-caption font-bold text-success">
          {/* 블로그(LLM) 추정값은 속 빈 점 + 출처 문구로 공식 데이터와 구분한다. 색만으로 전달하지 않는다. */}
          <span
            aria-hidden
            className={`shrink-0 rounded-full ${open.isLlm ? "h-2.5 w-2.5 border-2 border-success bg-transparent" : "h-2 w-2 bg-success"}`}
          />
          <span className="min-w-0">{open.isLlm ? `${open.label} · 블로그 기준` : open.label}</span>
        </p>
      ) : open?.reason ? (
        <p className="mt-3 flex min-w-0 items-center gap-1.5 text-caption font-bold text-danger">
          <span
            aria-hidden
            className={`shrink-0 rounded-full ${open.isLlm ? "h-2.5 w-2.5 border-2 border-danger bg-transparent" : "h-2 w-2 bg-danger"}`}
          />
          <span className="min-w-0">{open.isLlm ? `${open.reason} · 블로그 기준` : open.reason}</span>
        </p>
      ) : null}
      {/* 화장실·세차장은 '이용 정보' 칩(개방·운영시간, 편의시설, 휴무)과 같은 말을 반복하는 요약 문장을 숨긴다 */}
      {!(showMeta && meta.hours) && (
        <p className={`${statusRow ? "mt-1" : "mt-3"} line-clamp-2 text-body text-ink`}>{place.summary}</p>
      )}

      {hasField && (
        <div className="mt-2 space-y-1.5" aria-label="현장 정보">
          {(info.closedDays.length > 0 || info.hours || info.breakTime) && (
            <ul className="flex flex-wrap gap-1.5">
              {info.closedDays.length > 0 && (
                <li className="rounded-md border border-danger px-2 py-0.5 text-caption font-semibold text-danger">
                  정기휴무 {info.closedDays.join("·")}
                </li>
              )}
              {info.hours && (
                <li className="tnum rounded-md border border-line bg-bg px-2 py-0.5 text-caption font-semibold text-ink">
                  영업 {info.hours}
                </li>
              )}
              {info.breakTime && (
                <li className="tnum rounded-md border border-line bg-bg px-2 py-0.5 text-caption font-semibold text-ink">
                  브레이크 {info.breakTime}
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <FeedbackChip
            key={c.key}
            placeId={place.id}
            chipKey={c.key}
            icon={c.icon}
            label={c.label}
            count={feedbackCount(place, c.key)}
          />
        ))}
        <button
          onClick={() => {
            if (visitedEntry) {
              removeVisited(place.id);
              void pushVisited(place.id, false, null);
              setEditing(false);
              showToast("다녀옴을 취소했어요.");
            } else {
              setVisited(place, null);
              void pushVisited(place.id, true, null);
              setDraft("");
              setEditing(true); // 체크인과 함께 한 줄 메모 입력창을 연다
            }
          }}
          aria-pressed={!!visitedEntry}
          className={`theme-t inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-caption font-semibold active:opacity-80 ${
            visitedEntry ? "border-success bg-surface text-success" : "border-line bg-surface text-ink"
          }`}
        >
          <CategoryIcon k="visited" fill={!!visitedEntry} />
          다녀옴
        </button>
        <button
          onClick={() => onReportIssue(place)}
          className="theme-t inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-caption font-semibold text-muted active:opacity-80"
        >
          <TriangleAlert size={14} strokeWidth={2} aria-hidden />
          정보 오류 제보
        </button>
        {place.mode === "nopo" && (
          <button
            onClick={() => onAnchorParking(place)}
            className="theme-t inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-caption font-semibold text-ink active:opacity-80"
          >
            <CategoryIcon k="parking" />
            주변 주차장
          </button>
        )}
      </div>

      {visitedEntry &&
        (editing ? (
          <form
            className="mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = cleanNote(draft);
              setVisited(place, n);
              void pushVisited(place.id, true, n);
              setEditing(false);
            }}
          >
            <label className="block text-caption font-semibold text-muted" htmlFor={`note-${place.id}`}>
              다녀온 곳 한 줄 메모
            </label>
            <input
              id={`note-${place.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
              maxLength={NOTE_MAX}
              placeholder="예: 재방문 의사, 수육 추천"
              autoComplete="off"
              className="mt-1 h-11 w-full min-w-0 rounded-xl border border-line bg-bg px-3 text-[14px] text-ink placeholder:text-muted"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="min-h-[44px] cursor-pointer whitespace-nowrap rounded-xl bg-primary px-4 text-label font-bold text-on-primary active:opacity-90"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => {
                  setVisited(place, null);
                  void pushVisited(place.id, true, null);
                  setDraft("");
                  setEditing(false);
                }}
                className="min-h-[44px] cursor-pointer whitespace-nowrap rounded-xl border border-line bg-surface px-4 text-label font-semibold text-ink active:opacity-80"
              >
                메모 삭제
              </button>
              <span className="tnum ml-auto text-caption text-muted">
                {draft.length}/{NOTE_MAX}
              </span>
            </div>
          </form>
        ) : (
          <button
            onClick={() => {
              setDraft(visitedEntry.note ?? "");
              setEditing(true);
            }}
            aria-label="다녀온 곳 메모 수정"
            className="mt-2 flex min-h-[44px] w-full cursor-pointer items-center gap-1.5 rounded-xl border border-success bg-surface px-3 text-left text-label font-semibold text-success active:opacity-80"
          >
            <CategoryIcon k="visited" fill />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              다녀온 곳
              {visitedEntry.note ? (
                <span className="font-medium text-ink"> · {visitedEntry.note}</span>
              ) : (
                <span className="font-medium text-muted"> · 메모 남기기</span>
              )}
            </span>
          </button>
        ))}

      <div className="mt-3 flex gap-2">
        <NavigationButton
          target={{ name: place.name, lat: place.lat, lng: place.lng, category: place.category }}
          origin={origin}
        />
        <button
          onClick={() => sharePlace(place)}
          aria-label={`${place.name} 공유하기`}
          className="theme-t flex h-12 w-11 shrink-0 cursor-pointer flex-col items-center justify-center rounded-xl border border-line bg-surface text-ink active:opacity-80"
        >
          <Share2 size={16} aria-hidden />
          <span className="text-caption font-semibold">공유</span>
        </button>
        <button
          onClick={() => {
            const on = toggleFavorite(place);
            void pushFavorite(place.id, on);
          }}
          aria-pressed={fav}
          aria-label={fav ? `${place.name} 찜 해제` : `${place.name} 찜하기`}
          className={`theme-t flex h-12 w-11 shrink-0 cursor-pointer flex-col items-center justify-center rounded-xl border bg-surface active:opacity-80 ${
            fav ? "border-danger text-danger" : "border-line text-ink"
          }`}
        >
          <Heart size={16} aria-hidden fill={fav ? "currentColor" : "none"} />
          <span className="text-caption font-semibold">찜</span>
        </button>
      </div>

      {near && (
        <button
          onClick={() => onShowParking(near.parking.id)}
          className="theme-t mt-2 flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary bg-transparent px-3 text-label font-semibold text-primary active:scale-[0.98]"
        >
          <CategoryIcon k="parking" size={16} />
          인근 공영주차장 보기 · 도보 {near.walkMin}분
        </button>
      )}
      {syncedLabel(place) && (
        <p className="tnum mt-2 text-right text-caption text-muted" title="데이터를 마지막으로 확인한 달">
          {syncedLabel(place)}
        </p>
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

function agoText(diffMs: number): string {
  const min = Math.max(0, Math.round(diffMs / 60_000));
  if (min < 1) return "방금 저장";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

/* ───────────────────────── 메인 ───────────────────────── */

/** 공식 데이터로 영업 여부를 아는 상태인가(LLM 추정은 '미확인'으로 센다) */
const isOfficialKnown = (st: { status: boolean | null; isLlm?: boolean }) => st.status !== null && !st.isLlm;

const noopSubscribe = () => () => {};
const serverStartMode = (): Mode => "survival";

export default function Home() {
  // 첫 화면 모드: 마지막으로 고른 탭 기억 + 새 세션 심야(23~05시)만 생존 모드(src/lib/startMode.ts).
  // 서버 렌더·하이드레이션은 survival, 마운트 후 저장된 시작 모드로 맞춘다. 사용자가 탭을 누르면 그 값이 우선한다.
  const startMode = useSyncExternalStore(noopSubscribe, resolveStartMode, serverStartMode);
  const [pickedMode, setMode] = useState<Mode | null>(null);
  const mode: Mode = pickedMode ?? startMode;
  const [filter, setFilter] = useState("all");
  const [loc, setLoc] = useState<Loc>({ kind: "pending" });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [view, setView] = useState<View>("list"); // 기본값: 목록
  const [selectedId, setSelectedId] = useState<string | null>(null); // 지도에서 고른 핀
  const [openOnly, setOpenOnly] = useState(false); // '지금 영업 중 / 이용 가능(24시)' 필터
  const [searchOpen, setSearchOpen] = useState(false); // 빠른 키워드 검색 바 펼침
  const [coupleOpen, setCoupleOpen] = useState(false); // 커플 코드 시트
  const couple = useCouple();
  const visited = useVisited();
  const [query, setQuery] = useState(""); // 빠른 키워드 검색어
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim();
  const nowMs = useMinuteClock();
  const favorites = useFavorites();
  // scrollTargetId: 스크롤 이동 대상 / highlightId: 도착 후 링 강조 중인 카드
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const [refresh, setRefresh] = useState(0); // 조용한 새로고침(화면 유지)
  const [issueTarget, setIssueTarget] = useState<Place | null>(null); // '정보 오류 제보' 시트 대상
  const [patches, setPatches] = useState<Record<string, PlaceFeedback>>({}); // 내가/다른 기기가 방금 바꾼 feedback
  // 방금 접수·수신된 폐업/정보오류 제보 상태 (조회 결과 위에 덮어쓴다)
  const [issuePatches, setIssuePatches] = useState<
    Record<string, { reported_issue: Place["reported_issue"]; closure_reports: number }>
  >({});

  const [anchor, setAnchor] = useState<Anchor | null>(null); // '주변 주차장' 기준 노포 (null이면 평소 화면)
  const nearby = useNearby(loc, nonce, refresh);
  const anchorData = useAnchorParking(anchor, nonce);
  const loading = anchor ? anchorData.loading : nearby.loading;
  const error = anchor ? anchorData.error : nearby.error;
  const fetched = anchor ? anchorData.places : nearby.places;
  const staleAt = anchor ? null : nearby.staleAt;
  // 조회 결과 위에 최신 현장 정보(내 등록 + 실시간 수신)를 덮어쓴다
  const all = useMemo(
    () =>
      fetched.map((p) => {
        const fb = patches[p.id];
        const issue = issuePatches[p.id];
        return fb || issue ? { ...p, ...(fb ? { feedback: fb } : {}), ...(issue ?? {}) } : p;
      }),
    [fetched, patches, issuePatches],
  );

  // 현재 화면에 있는 장소 id (실시간 변경 중 관련 있는 것만 반영하기 위해)
  const visibleIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    visibleIds.current = new Set(fetched.map((p) => p.id));
  }, [fetched]);

  // 두 기기 실시간 공유: bml_places 변경(Supabase Realtime) 수신. 004 마이그레이션이 테이블을 publication에 등록한다.
  // 미설정/오프라인이어도 앱은 그대로 동작하고, 아래 '다시 켰을 때 새로고침'이 보완한다.
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    let cleanup = () => {};
    try {
      const sb = getSupabase();
      const channel = sb
        .channel("bml-places-live")
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bml_places" }, (payload) => {
          const row = payload.new as {
            id?: string;
            feedback?: PlaceFeedback;
            reported_issue?: Place["reported_issue"];
            closure_reports?: number;
          };
          if (!row?.id || !visibleIds.current.has(row.id)) return;
          const id = row.id;
          if (row.feedback) {
            const feedback = row.feedback;
            setPatches((prev) => ({ ...prev, [id]: feedback }));
          }
          // 006 이후: 폐업·정보오류 제보 상태도 다른 기기에 바로 반영
          if ("reported_issue" in row) {
            setIssuePatches((prev) => ({
              ...prev,
              [id]: { reported_issue: row.reported_issue ?? null, closure_reports: row.closure_reports ?? 0 },
            }));
          }
        })
        .subscribe();
      cleanup = () => {
        sb.removeChannel(channel);
      };
    } catch (e) {
      console.error("realtime", e);
    }
    return () => cleanup();
  }, []);

  // 앱을 잠시 떠났다(30초+) 돌아오면 조용히 최신 데이터로 갱신 (실시간 연결이 끊겼을 때의 보완)
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 30_000) {
        hiddenAt = 0;
        setRefresh((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // 네트워크가 돌아오면 자동으로 다시 불러온다 (오프라인 캐시 배너 해제)
  useEffect(() => {
    const onOnline = () => setNonce((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

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
    setAnchor(null);
    setLoc({ kind: "gps", name: "현재 위치", ...p });
    return true;
  }, []);

  const pickLocation = (l: PickedLocation) => {
    setAnchor(null);
    setLoc({ kind: "search", ...l });
    setSheetOpen(false);
  };

  const changeMode = (m: Mode) => {
    rememberMode(m); // 사용자가 직접 고른 탭만 기억한다(심야 자동 전환·주차 연결은 저장 안 함)
    setAnchor(null);
    setMode(m);
    setFilter("all");
    setSelectedId(null);
  };

  // 칩은 항상 1개만 활성: 카테고리/연차/찜을 고르면 '지금 영업 중'은 꺼진다
  // 이미 활성인 칩을 한 번 더 누르면 '전체'로 돌아간다
  const changeFilter = (k: string) => {
    setOpenOnly(false);
    setFilter(k === filter && k !== "all" ? "all" : k);
    setSelectedId(null);
  };

  // 지도 이동 후 '이 지역 다시 찾기': 현재 지도 중심을 새 조회 기준으로 삼아 목록·핀을 다시 불러온다
  const searchHere = (c: { lat: number; lng: number }) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showToast("오프라인 상태에서는 새로운 지역을 조회할 수 없어요.");
      return;
    }
    setSelectedId(null);
    setAnchor(null);
    setLoc({ kind: "search", name: "지도 현위치", lat: c.lat, lng: c.lng });
  };

  const changeView = (v: View) => {
    setView(v);
    setSelectedId(null);
    if (v === "map") window.scrollTo({ top: 0 });
  };

  // 노포 카드 '주변 주차장': 이 가게 좌표를 기준점으로 생존 모드 > 공영주차장을 연다
  const startAnchor = (p: Place) => {
    setAnchor({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, returnFilter: filter });
    setMode("survival");
    setFilter("parking");
    setOpenOnly(false);
    setSelectedId(null);
    setHighlightId(null);
    window.scrollTo({ top: 0 });
  };

  // '노포로 돌아가기': 기준점을 풀고 원래 보던 노포 목록(기존 위치 기준)으로, 그 가게 카드로 복귀한다
  const endAnchor = () => {
    if (!anchor) return;
    const back = anchor;
    setAnchor(null);
    setMode("nopo");
    setFilter(back.returnFilter);
    setOpenOnly(false);
    setSelectedId(null);
    setScrollTargetId(null);
    window.setTimeout(() => setScrollTargetId(back.id), 50);
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
      clearTimer = window.setTimeout(() => {
        setHighlightId(null);
        setScrollTargetId(null);
      }, 2500);
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
  // 찜 거리 재계산용 기준 위치 (참조가 loc가 바뀔 때만 바뀌게 한다)
  const centerPoint = useMemo(
    () =>
      anchor
        ? { lat: anchor.lat, lng: anchor.lng }
        : loc.kind === "pending"
          ? null
          : { lat: loc.lat, lng: loc.lng },
    [loc, anchor],
  );
  // 현재 모드에 영업시간이 확인된(상태가 true/false) 장소가 하나도 없으면 '지금 영업 중' 칩을 숨긴다 (빈 결과 유입 방지)
  const hasKnownHours = useMemo(
    () => all.some((p) => p.mode === mode && isVisiblePlace(p) && isOfficialKnown(getOpenState(p, nowMs))),
    [all, mode, nowMs],
  );
  const openActive = openOnly && hasKnownHours;
  const clock = openActive ? nowMs : 0; // 필터를 끄면 분 단위 시계 변화로 재계산하지 않는다
  const { counts, favCount, visitedCount, activeFilter, rawPlaces, unknownExcluded } = useMemo(() => {
    // 노포 모드는 인허가 연도로 업력이 검증된 가게(10년+)와 유저 제보만 노출한다
    const base = all.filter((p) => p.mode === mode && isVisiblePlace(p));
    // 찜 목록: 기기에 저장된 스냅샷이라 오프라인·다른 동네에서도 보인다. 조회된 최신 정보가 있으면 그것을 쓰고,
    // 없으면 스냅샷의 거리를 현재 기준 위치로 다시 계산한다.
    const fresh = new Map(all.map((p) => [p.id, p]));
    const toBase = (list: Place[]) =>
      list
        .filter((p) => p.mode === mode)
        .map(
          (p) =>
            fresh.get(p.id) ??
            (centerPoint ? { ...p, distance_m: distanceM(centerPoint.lat, centerPoint.lng, p.lat, p.lng) } : p),
        )
        .sort((a, b) => a.distance_m - b.distance_m);
    const favBase = toBase(Object.values(favorites));
    const visitedBase = toBase(Object.values(visited).map((v) => v.place)); // '다녀옴' 체크인 장소
    // '지금 영업 중'이 켜지면 확실히 이용 가능(true)한 곳만 남긴다. 모르는 곳(null)은 허위 표시 없이 제외한다.
    const isOpen = (p: Place) => {
      const st = getOpenState(p, clock);
      return st.status === true && !st.isLlm; // 블로그(LLM) 추정값은 필터에서 제외(보수적)
    };
    const pool = openActive ? base.filter(isOpen) : base;
    const favPool = openActive ? favBase.filter(isOpen) : favBase;
    const visitedPool = openActive ? visitedBase.filter(isOpen) : visitedBase;
    const counts: Record<string, number> | null =
      loading || error
        ? null
        : {
            ...Object.fromEntries(
              FILTERS[mode].map((f) => [f.key, pool.filter((p) => matchesFilter(p, f.key)).length]),
            ),
            fav: favBase.length,
            visited: visitedBase.length,
          };
    // 찜 칩은 0건이어도 누르면 그대로 활성(빈 안내 표시) — '전체'가 같이 켜진 것처럼 보이지 않게 한다
    // '다녀옴' 칩은 1곳 이상일 때만 보이므로, 0곳이 되면 '전체'로 돌린다
    const activeFilter =
      filter === "fav"
        ? "fav"
        : filter === "visited"
          ? visitedBase.length > 0
            ? "visited"
            : "all"
          : counts && !counts[filter] && !isCoreChip(mode, filter)
            ? "all"
            : filter;
    const unknownExcluded = openActive
      ? (activeFilter === "fav" ? favBase : activeFilter === "visited" ? visitedBase : base).filter(
          (p) => matchesFilter(p, activeFilter) && !isOfficialKnown(getOpenState(p, clock)),
        ).length
      : 0;
    return {
      counts,
      favCount: favBase.length,
      visitedCount: visitedBase.length,
      activeFilter,
      rawPlaces: (activeFilter === "fav"
        ? favPool
        : activeFilter === "visited"
          ? visitedPool
          : pool.filter((p) => matchesFilter(p, activeFilter))
      ).filter((p) => matchesQuery(p, q)),
      unknownExcluded,
    };
  }, [all, mode, filter, loading, error, openActive, clock, favorites, visited, centerPoint, q]);

  // 분 단위 갱신으로 목록 내용이 그대로인데 배열만 새로 만들어져 지도가 다시 맞춰지지 않도록 id 기준으로 참조를 유지한다
  const placesKey = rawPlaces.map((p) => p.id).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const places = useMemo(() => rawPlaces, [placesKey]);

  // 목록은 거리순 상위 30곳만 먼저 그리고 '더 보기'로 30곳씩 늘린다. 조회 조건이 바뀌면 key 가 달라져 자동으로 30곳으로 돌아간다.
  // (지도 핀·건수는 전체 매칭 기준: places/rawPlaces 그대로)
  const listKey = `${mode}|${filter}|${openActive}|${q}|${view}|${anchor?.id ?? ""}|${loc.kind === "pending" ? "p" : `${loc.lat},${loc.lng}`}`;
  const [pageState, setPageState] = useState({ key: listKey, n: PAGE_SIZE });
  // 조건이 바뀌면 저장된 개수를 바로 버린다(렌더 중 상태 조정). 안 그러면 이전 조건으로 돌아왔을 때 옛 개수가 되살아난다.
  if (pageState.key !== listKey) setPageState({ key: listKey, n: PAGE_SIZE });
  const baseShown = pageState.key === listKey ? pageState.n : PAGE_SIZE;
  // 스크롤 이동 대상(주변 주차장·복귀)이 아직 안 그려진 위치면 거기까지 펼친다
  const targetIdx = scrollTargetId ? rawPlaces.findIndex((p) => p.id === scrollTargetId) : -1;
  const shown = Math.max(baseShown, targetIdx + 1);
  const remaining = Math.max(rawPlaces.length - shown, 0);
  const showMore = () => setPageState({ key: listKey, n: shown + PAGE_SIZE });

  // 카드(목록·지도 하단)는 최신 현장 정보가 담긴 rawPlaces로, 지도 핀(places)은 id가 같으면 참조를 유지해 화면이 다시 맞춰지지 않게 한다
  const selected = rawPlaces.find((p) => p.id === selectedId) ?? null;
  // 길찾기 출발지: GPS면 '내 위치', 선택한 동네/역이면 그 이름
  const origin: NavOrigin | undefined =
    loc.kind === "pending"
      ? undefined
      : { lat: loc.lat, lng: loc.lng, label: loc.kind === "gps" ? "내 위치" : loc.name };
  const center = anchor
    ? { lat: anchor.lat, lng: anchor.lng, name: anchor.name }
    : loc.kind === "pending"
      ? null
      : { lat: loc.lat, lng: loc.lng, name: loc.kind === "gps" ? "현재 위치" : loc.name };

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md overflow-x-clip md:max-w-2xl">
      <InstallBar />
      <header className="px-4 pt-[max(20px,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="theme-t text-title1 font-extrabold tracking-[-0.03em] text-primary max-[359px]:text-[22px] max-[339px]:text-[20px]">
              Bravo My Life
            </h1>
            <p className="mt-0.5 text-label text-muted max-[399px]:text-[12px] max-[399px]:leading-4">내 손안의 동네 생존 &amp; 찐노포 가이드</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <LocationBadge loc={loc} onClick={() => setSheetOpen(true)} />
            <button
              type="button"
              onClick={() => setCoupleOpen(true)}
              aria-label={couple.code ? `커플 코드 연동 중, 코드 ${couple.code}` : "커플 코드 연동"}
              aria-haspopup="dialog"
              className="theme-t relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-primary"
            >
              <HeartHandshake size={18} strokeWidth={2} aria-hidden />
              {couple.code && (
                <span aria-hidden className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-surface bg-success" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchOpen((o) => !o);
              }}
              aria-label={q ? `빠른 검색, 검색어 ${q}` : "빠른 검색"}
              aria-expanded={searchOpen}
              aria-controls="quick-search"
              className={`theme-t relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border text-primary ${
                searchOpen || q ? "border-primary bg-surface" : "border-line bg-surface"
              }`}
            >
              <Search size={18} strokeWidth={2} aria-hidden />
              {q && <span aria-hidden className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-surface bg-primary" />}
            </button>
          </div>
        </div>
        {searchOpen && (
          <form
            id="quick-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              searchRef.current?.blur();
            }}
            className="mt-3 flex items-center gap-1"
          >
            <div className="relative min-w-0 flex-1">
              <input
                ref={searchRef}
                autoFocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={30}
                enterKeyHint="search"
                placeholder="가게명, 메뉴, 24시, 셀프세차 검색"
                aria-label="빠른 키워드 검색"
                className={`theme-t h-11 w-full min-w-0 rounded-xl border border-line bg-surface pl-3 text-[14px] text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:hidden ${
                  query ? "pr-11" : "pr-3"
                }`}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  aria-label="검색어 지우기"
                  className="absolute right-0 top-0 flex h-11 w-11 cursor-pointer items-center justify-center text-muted"
                >
                  <X size={16} strokeWidth={2} aria-hidden />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSearchOpen(false);
              }}
              className="min-h-[44px] shrink-0 cursor-pointer whitespace-nowrap px-2 text-label font-semibold text-muted active:opacity-70"
            >
              닫기
            </button>
          </form>
        )}
      </header>

      <div className="theme-t sticky top-0 z-10 mt-4 space-y-3 bg-bg px-4 pb-3 pt-2 shadow-sticky">
        {staleAt !== null && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 rounded-xl border border-warning bg-surface pl-3 text-caption font-semibold text-warning"
          >
            <span>
              오프라인 상태 · 마지막으로 불러온 주변 장소입니다
              {nowMs > 0 && ` (${agoText(nowMs - staleAt)})`}
            </span>
            <button
              onClick={() => setNonce((n) => n + 1)}
              className="min-h-[44px] shrink-0 cursor-pointer px-3 text-label font-bold text-primary"
            >
              다시 연결
            </button>
          </div>
        )}
        <ModeTabs mode={mode} onChange={changeMode} />
        <div className="flex items-center gap-2">
          <FilterChips
            mode={mode}
            value={openActive ? "open-now" : activeFilter}
            counts={counts}
            favCount={favCount}
            visitedCount={visitedCount}
            onChange={changeFilter}
            showOpenChip={hasKnownHours}
            openOnly={openActive}
            onToggleOpen={() => {
              // '지금 영업 중'을 켜면 전체 기준으로 보며 다른 칩의 활성 표시는 꺼진다
              if (!openActive) setFilter("all");
              setOpenOnly(!openActive);
              setSelectedId(null);
            }}
          />
          <ViewToggle view={view} onChange={changeView} />
        </div>
        {anchor && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl border border-primary bg-surface pl-3 text-caption font-semibold text-ink"
          >
            <MapPin size={14} strokeWidth={2} className="shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {anchor.name} 주변 공영주차장
              <span className="max-[359px]:hidden"> · 반경 {anchorData.radius}m</span>
            </span>
            <button
              onClick={endAnchor}
              className="min-h-[44px] shrink-0 cursor-pointer whitespace-nowrap px-3 text-caption font-bold text-primary active:opacity-70"
            >
              노포로 돌아가기
            </button>
          </div>
        )}
      </div>

      <main
        className="space-y-3 px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-4"
        aria-busy={loading}
      >
        {loading && activeFilter !== "fav" && activeFilter !== "visited" ? (
          view === "map" ? (
            <div className="h-[calc(100dvh-250px)] min-h-[380px] animate-pulse rounded-2xl bg-tag-bg" aria-hidden />
          ) : (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          )
        ) : error && activeFilter !== "fav" && activeFilter !== "visited" ? (
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
            onSearchHere={searchHere}
          >
            {selected && (
              <PlaceCard
                place={selected}
                all={all}
                highlighted={false}
                onShowParking={showParking}
                onAnchorParking={startAnchor}
                anchorName={anchor?.name}
                nowMs={nowMs}
                origin={origin}
                onReportIssue={setIssueTarget}
              />
            )}
          </PlaceMap>
        ) : places.length === 0 && q ? (
          <div className="py-12 text-center" role="status">
            <p className="text-body text-muted [overflow-wrap:anywhere]">‘{q}’에 맞는 장소가 없어요</p>
            <button
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="mt-3 min-h-[44px] cursor-pointer rounded-xl border border-primary px-5 text-label font-semibold text-primary"
            >
              검색어 지우기
            </button>
          </div>
        ) : places.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-body text-muted">
              {activeFilter === "fav" && favCount === 0
                ? "아직 찜한 장소가 없어요. 카드의 하트를 눌러 담아 보세요."
                : anchor && activeFilter === "parking"
                ? `${anchor.name} 반경 800m 안에 등록된 공영주차장이 없어요.`
                : !openActive && EMPTY_MESSAGE[activeFilter]
                ? EMPTY_MESSAGE[activeFilter]
                : openActive
                ? `지금 ${mode === "survival" ? "이용 가능(24시)" : "영업 중"}으로 확인된 장소가 없어요.`
                : "반경 2km 안에 조건에 맞는 장소가 아직 없어요."}
            </p>
            {openActive && (
              <button
                onClick={() => setOpenOnly(false)}
                className="mt-3 min-h-[44px] cursor-pointer rounded-xl bg-primary px-5 text-label font-bold text-on-primary"
              >
                필터 끄고 전체 보기
              </button>
            )}
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
          rawPlaces.slice(0, shown).map((p) => (
            <PlaceCard
              key={p.id}
              place={p}
              all={all}
              highlighted={p.id === highlightId}
              onShowParking={showParking}
              onAnchorParking={startAnchor}
              anchorName={anchor?.name}
              nowMs={nowMs}
              origin={origin}
              onReportIssue={setIssueTarget}
            />
          ))
        )}
        {view === "list" && !loading && !error && remaining > 0 && (
          <button
            onClick={showMore}
            className="theme-t flex h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary bg-tag-bg text-label font-bold text-primary active:opacity-80"
          >
            더 보기 (남은 {remaining}곳)
            <ChevronDown size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
        {openActive && unknownExcluded > 0 && !loading && !error && (
          <p className="text-center text-caption text-muted" role="note">
            영업시간 미확인 장소 {unknownExcluded}곳 제외됨
          </p>
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


      {coupleOpen && <CoupleSheet onClose={() => setCoupleOpen(false)} />}

      {issueTarget && (
        <IssueReportSheet
          place={issueTarget}
          onClose={() => setIssueTarget(null)}
          onReported={(id, res) => setIssuePatches((prev) => ({ ...prev, [id]: res }))}
        />
      )}

      {reportOpen && (
        <ReportSheet
          defaultMode={mode}
          onClose={() => setReportOpen(false)}
          getPosition={getGps}
          onDone={() => {
            setReportOpen(false);
            setNonce((n) => n + 1); // 방금 제보한 장소가 목록에 반영되도록 다시 조회
            showToast("제보가 등록됐어요. 고마워요!");
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
