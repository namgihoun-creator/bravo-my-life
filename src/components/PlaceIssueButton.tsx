"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Place } from "@/data/places";
import IssueReportSheet from "@/components/IssueReportSheet";

/**
 * 상세 페이지의 '정보 오류 제보' 진입점(카드와 같은 IssueReportSheet). 공유 링크로 들어온 사람도 누를 수 있다.
 * 서버가 돌려준 누적 상태는 이 페이지가 캐시되어 있어 즉시 반영되지 않으므로, 접수 후에는 이 기기에서만 안내 문구를 바꾼다.
 */
export default function PlaceIssueButton({ place }: { place: Place }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="theme-t mt-5 flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-label font-semibold text-muted active:opacity-80"
      >
        <TriangleAlert size={14} strokeWidth={2} aria-hidden />
        {done ? "제보 고마워요 · 다른 제보도 보낼 수 있어요" : "폐업했거나 정보가 달라요 · 정보 오류 제보"}
      </button>
      {open && (
        <IssueReportSheet place={place} onClose={() => setOpen(false)} onReported={() => setDone(true)} />
      )}
    </>
  );
}
