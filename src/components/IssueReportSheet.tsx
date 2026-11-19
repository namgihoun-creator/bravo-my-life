"use client";

import { useModalHistory } from "@/lib/useModalHistory";
import { useEffect, useState } from "react";
import { Clock3, TriangleAlert, X } from "lucide-react";
import type { IssueType, Place } from "@/data/places";
import { getSupabase } from "@/lib/supabase";
import { showToast } from "@/lib/toast";

/** 이 기기에서 이미 보낸 제보(장소·유형별 1회). 같은 기기의 반복 제보로 숫자가 부풀지 않게 한다 */
const SENT_KEY = "bml_issue_reports";

function readSent(placeId: string): Partial<Record<IssueType, boolean>> {
  try {
    const all = JSON.parse(localStorage.getItem(SENT_KEY) || "{}") as Record<string, Partial<Record<IssueType, boolean>>>;
    return all[placeId] ?? {};
  } catch {
    return {};
  }
}

function markSent(placeId: string, type: IssueType) {
  try {
    const all = JSON.parse(localStorage.getItem(SENT_KEY) || "{}") as Record<string, Partial<Record<IssueType, boolean>>>;
    all[placeId] = { ...all[placeId], [type]: true };
    localStorage.setItem(SENT_KEY, JSON.stringify(all));
  } catch {
    /* 저장 불가: 이번 화면에서만 중복을 막는다 */
  }
}

/** 카드의 '정보 오류 제보' 바텀 시트: 폐업·정보 변경을 원탭으로 알린다(텍스트 입력 없음). */
export default function IssueReportSheet({
  place,
  onClose,
  onReported,
}: {
  place: Place;
  onClose: () => void;
  /** 폐업·정보오류 제보가 접수됐을 때(서버가 돌려준 누적 상태) */
  onReported: (placeId: string, result: { reported_issue: IssueType; closure_reports: number }) => void;
}) {
  const [sent, setSent] = useState<Partial<Record<IssueType, boolean>>>(() => readSent(place.id));
  const [reporting, setReporting] = useState<IssueType | null>(null);
  const [reportMsg, setReportMsg] = useState<string | null>(null);

  async function report(type: IssueType) {
    if (sent[type] || reporting) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setReportMsg("오프라인 상태에서는 제보할 수 없어요.");
      return;
    }
    setReporting(type);
    setReportMsg(null);
    try {
      const { data, error } = await getSupabase().rpc("report_place_issue", { p_place_id: place.id, p_issue_type: type });
      if (error) throw error;
      markSent(place.id, type);
      setSent((prev) => ({ ...prev, [type]: true }));
      const res = (data ?? {}) as { reported_issue?: IssueType; closure_reports?: number };
      onReported(place.id, { reported_issue: res.reported_issue ?? type, closure_reports: res.closure_reports ?? 1 });
      showToast("제보 고마워요! 다른 분들이 헛걸음하지 않게 카드에 표시돼요.");
    } catch (e) {
      console.error("report_place_issue", e);
      // 006 마이그레이션 전에는 함수가 없다 → 앱은 멈추지 않고 안내만 한다
      setReportMsg("지금은 제보를 받을 수 없어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setReporting(null);
    }
  }
  useModalHistory(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
      <button aria-label="닫기" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="정보 오류 제보"
        className="sheet-up relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-sticky"
      >
        <div className="sheet-grabber" aria-hidden />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-title2 font-bold tracking-[-0.02em]">정보 오류 제보</h2>
            <p className="mt-0.5 truncate text-caption text-muted">{place.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <section className="mt-3 rounded-xl border border-line bg-bg p-3" aria-label="폐업·정보 오류 제보">
          <p className="text-caption font-semibold text-muted">잘못된 정보를 발견했나요? 한 번만 눌러 알려 주세요</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => report("closed")}
              disabled={!!sent.closed || reporting !== null}
              className={`inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-label font-semibold disabled:cursor-default ${
                sent.closed ? "border-line text-muted" : "border-danger text-danger"
              }`}
            >
              <TriangleAlert size={14} strokeWidth={2} aria-hidden />
              {sent.closed ? "폐업 제보 접수됨" : reporting === "closed" ? "보내는 중…" : "폐업/이전했어요"}
            </button>
            <button
              type="button"
              onClick={() => report("info_changed")}
              disabled={!!sent.info_changed || reporting !== null}
              className={`inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-label font-semibold disabled:cursor-default ${
                sent.info_changed ? "border-line text-muted" : "border-line bg-surface text-ink"
              }`}
            >
              <Clock3 size={14} strokeWidth={2} aria-hidden />
              {sent.info_changed ? "변경 제보 접수됨" : reporting === "info_changed" ? "보내는 중…" : "운영시간·요금이 달라요"}
            </button>
          </div>
          {reportMsg && (
            <p role="alert" className="mt-2 text-caption font-semibold text-danger">
              {reportMsg}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
