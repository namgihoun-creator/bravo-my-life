"use client";

import { Share2 } from "lucide-react";
import type { Place } from "@/data/places";
import { sharePlace } from "@/lib/share";

/** 상세 페이지 공유: 가게 정보 + 이 페이지 URL(`share.ts` 가 노포에는 상세 URL을 넣는다) */
export default function PlaceShareButton({ place }: { place: Place }) {
  return (
    <button
      type="button"
      onClick={() => sharePlace(place)}
      aria-label={`${place.name} 공유하기`}
      className="theme-t flex h-12 w-11 shrink-0 cursor-pointer flex-col items-center justify-center rounded-xl border border-line bg-surface text-ink active:opacity-80"
    >
      <Share2 size={16} aria-hidden />
      <span className="text-caption font-semibold">공유</span>
    </button>
  );
}
