"use client";

import Link from "next/link";
import { Award } from "lucide-react";
import CategoryIcon from "@/components/CategoryIcon";
import { FILTERS, ageTier, foodLabel, yearsInBusiness, type Place } from "@/data/places";
import { isLive } from "@/lib/livePlaces";
import { openNavigation, useNavApp, type NavOrigin } from "@/lib/navigation";
import { getOpenState } from "@/lib/openStatus";

/** 시·도 이름을 뗀 간략 주소 ('경기 부천시 원미구 …' → '부천시 원미구 …') */
const shortAddress = (a: string | null) => (a ? a.replace(/^\S+\s+/, "") : "");

const distText = (m: number) => {
  const d = Math.round(m);
  return d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${d}m`;
};

/** 모드 토큰(tag-bg·tag-text·border)이라 생존=블루, 노포=웜 브라운 톤으로 자연스럽게 바뀐다 */
const navPill =
  "theme-t flex h-11 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border border-line bg-tag-bg px-3.5 text-caption font-semibold text-tag-text active:opacity-80";

/**
 * 컴팩트 리스트 한 줄(약 76~84px). 한 화면에 6~8곳이 보이게 이름·핵심 뱃지·업종·거리·주소만 둔다.
 * - 노포: 행 전체가 `/place/[id]` 상세 링크(상세 페이지는 노포만 있다).
 * - 생존·실시간 폴백: 상세 페이지가 없으므로 행을 누르면 그 자리에서 전체 카드로 펼친다(`onExpand`).
 * - 우측 `길찾기` 알약(높이 44px)은 행 클릭과 겹치지 않는 형제 요소라 클릭이 전파되지 않는다. 찜은 카드형·상세 페이지에서 쓴다.
 */
export default function CompactPlaceRow({
  place,
  nowMs,
  origin,
  highlighted,
  onExpand,
}: {
  place: Place;
  nowMs: number;
  origin?: NavOrigin;
  highlighted: boolean;
  onExpand: (place: Place) => void;
}) {
  const live = isLive(place.id);
  const nopo = place.mode === "nopo";
  const [app] = useNavApp();
  const years = nopo ? yearsInBusiness(place) : null;
  const tier = years !== null && years >= 10 ? ageTier(years) : null;
  const open = !nopo && !live && nowMs > 0 ? getOpenState(place, nowMs) : null;
  const catLabel = nopo
    ? (foodLabel(place) ?? "")
    : (FILTERS.survival.find((f) => f.key === place.category)?.label ?? "");
  const addr = shortAddress(place.address);

  const badge = nopo ? (
    <span
      className={`theme-t inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption font-bold ${
        tier ? `age-badge age-badge-${tier}` : "bg-accent text-on-accent"
      }`}
    >
      <Award size={12} strokeWidth={2} aria-hidden />
      {tier ? `업력 ${years}년` : place.badge}
    </span>
  ) : live ? (
    <span className="inline-flex shrink-0 items-center rounded-full bg-accent px-2 py-0.5 text-caption font-bold text-on-accent">
      {place.badge}
    </span>
  ) : open?.status ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-caption font-bold text-success">
      <span aria-hidden className={`h-2 w-2 rounded-full ${open.isLlm ? "border-2 border-success" : "bg-success"}`} />
      {open.label}
    </span>
  ) : open?.reason ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-caption font-bold text-danger">
      <span aria-hidden className={`h-2 w-2 rounded-full ${open.isLlm ? "border-2 border-danger" : "bg-danger"}`} />
      {open.reason}
    </span>
  ) : null;

  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-body font-bold tracking-[-0.02em] text-ink">{place.name}</span>
        {badge}
      </span>
      <span className="tnum mt-1 flex min-w-0 items-center gap-1 text-label text-muted">
        <CategoryIcon k={place.category} size={13} />
        {catLabel && <span className="shrink-0 font-semibold">{catLabel}</span>}
        <span className="shrink-0">· {distText(place.distance_m)}</span>
        {addr && <span className="min-w-0 truncate">· {addr}</span>}
      </span>
      {place.reported_issue === "closed" && (
        <span className="mt-0.5 block truncate text-caption font-bold text-warning">폐업 의심 · 방문 전 확인</span>
      )}
    </>
  );
  const bodyCls =
    "flex min-h-[76px] min-w-0 flex-1 cursor-pointer flex-col justify-center rounded-l-xl py-2.5 pl-3 pr-1 text-left active:bg-tag-bg";

  return (
    <div
      id={`place-${place.id}`}
      className={`theme-t flex items-center gap-1 rounded-xl border border-line bg-surface pr-2.5 ${
        place.mode === "survival" ? "border-l-4 border-l-primary" : ""
      } ${highlighted ? "ring-2 ring-primary" : ""}`}
    >
      {nopo ? (
        <Link href={`/place/${place.id}`} prefetch={false} aria-label={`${place.name} 상세 보기`} className={bodyCls}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={() => onExpand(place)} aria-label={`${place.name} 자세히 보기`} className={bodyCls}>
          {body}
        </button>
      )}
      <button
        type="button"
        onClick={() => openNavigation(app, { name: place.name, lat: place.lat, lng: place.lng, category: place.category }, origin)}
        aria-label={`${place.name} 길찾기`}
        className={navPill}
      >
        길찾기
      </button>
    </div>
  );
}
