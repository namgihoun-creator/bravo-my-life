"use client";

import { naverSearchQuery } from "@/lib/navUrls";
import { openNaverPlaceSearch } from "@/lib/navigation";

const btn =
  "theme-t flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-2 text-label font-bold text-ink active:opacity-80";

/**
 * 영업정보 확인 버튼 한 줄: [네이버 정보] [카카오 정보].
 * - 네이버: `구 + 상호명` 검색(앱 → 웹 폴백). 오늘 임시휴무·최근 후기는 네이버가 가장 빠르다.
 * - 카카오: 장소 id 로 가게 하나를 직접 연다(검색 오탐 없음). id 가 없으면 이 버튼만 숨긴다.
 * 블로그 추정 시간과 별개로, 사용자가 직접 최신 정보를 확인하는 출구다(앱은 아무 정보도 가져오지 않는다).
 */
export default function PlaceInfoLinks({
  name,
  address,
  kakaoUrl,
}: {
  name: string;
  address: string | null;
  kakaoUrl: string | null;
}) {
  return (
    <div className="mt-3">
      <p className="text-caption text-muted">오늘 영업 여부·최근 후기는 지도 앱에서 확인해 보세요</p>
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={() => openNaverPlaceSearch(naverSearchQuery(name, address))}
          aria-label={`${name} 네이버 영업정보 확인`}
          className={btn}
        >
          <span aria-hidden className="nav-dot nav-dot-naver">
            N
          </span>
          <span className="truncate">네이버 정보</span>
        </button>
        {kakaoUrl && (
          <a
            href={kakaoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${name} 카카오맵 영업정보 확인`}
            className={btn}
          >
            <span aria-hidden className="nav-dot nav-dot-kakao">
              K
            </span>
            <span className="truncate">카카오 정보</span>
          </a>
        )}
      </div>
    </div>
  );
}
