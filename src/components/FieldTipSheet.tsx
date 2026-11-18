"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, TriangleAlert, X } from "lucide-react";
import { DAY_CHARS, fieldInfo, type IssueType, type Place, type PlaceFeedback } from "@/data/places";
import { getSupabase } from "@/lib/supabase";
import { showToast } from "@/lib/toast";

/** 숫자만 입력해도 'HH:MM~HH:MM'으로 자동 서식 (한 손 입력용: 숫자 키패드) */
function formatRange(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  let out = d.slice(0, 2);
  if (d.length > 2) out += ":" + d.slice(2, 4);
  if (d.length > 4) out += "~" + d.slice(4, 6);
  if (d.length > 6) out += ":" + d.slice(6, 8);
  return out;
}

/** 빈 값은 ''(삭제), 완전하고 올바른 값은 정규화된 문자열, 잘못된 값은 null */
function normalizeRange(v: string): string | null {
  if (!v.trim()) return "";
  const m = /^(\d{2}):(\d{2})~(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number);
  if (h1 > 23 || m1 > 59 || h2 > 24 || m2 > 59 || (h2 === 24 && m2 !== 0)) return null;
  return v;
}

const TIP_MAX = 80;

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
const SPAM = /https?:|www\.|[a-z0-9-]+\.(com|net|kr|io|me|co)(?![a-z])|@/i;

export default function FieldTipSheet({
  place,
  onClose,
  onSaved,
  onReported,
}: {
  place: Place;
  onClose: () => void;
  /** RPC가 돌려준 최신 feedback (현장 정보 병합 결과) */
  onSaved: (placeId: string, feedback: PlaceFeedback) => void;
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
  const info = fieldInfo(place);
  const [days, setDays] = useState<Set<string>>(new Set(info.closedDays));
  const [hours, setHours] = useState(info.hours ?? "");
  const [brk, setBrk] = useState(info.breakTime ?? "");
  const [tip, setTip] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleDay = (d: string) =>
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const h = normalizeRange(hours);
    const b = normalizeRange(brk);
    if (h === null) return setError("영업시간은 11:00~21:00 형식으로 입력해 주세요.");
    if (b === null) return setError("브레이크타임은 15:00~17:00 형식으로 입력해 주세요.");
    const text = tip.trim();
    if (SPAM.test(text)) return setError("링크나 연락처는 팁에 넣을 수 없어요.");

    const closed = DAY_CHARS.filter((d) => days.has(d));
    const changed =
      closed.join() !== info.closedDays.join() || h !== (info.hours ?? "") || b !== (info.breakTime ?? "") || !!text;
    if (!changed) return setError("바뀐 내용이 없어요. 휴무일·시간·팁 중 하나를 입력해 주세요.");

    setError(null);
    setBusy(true);
    const { data, error: rpcError } = await getSupabase().rpc("bml_add_place_tip", {
      p_place_id: place.id,
      p_closed_days: closed,
      p_hours: h,
      p_break_time: b,
      p_tip: text || null,
    });
    setBusy(false);
    if (rpcError) {
      console.error("bml_add_place_tip", rpcError);
      setError(
        navigator.onLine === false
          ? "오프라인 상태예요. 네트워크가 연결되면 다시 시도해 주세요."
          : "등록하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
      return;
    }
    onSaved(place.id, (data ?? {}) as PlaceFeedback);
    onClose();
  }

  const input =
    "min-h-[44px] w-full rounded-xl border border-line bg-bg px-3 text-body text-ink placeholder:text-muted tnum";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
      <button aria-label="닫기" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="현장 정보 추가"
        className="sheet-up relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-sticky"
      >
        <div className="sheet-grabber" aria-hidden />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-title2 font-bold tracking-[-0.02em]">현장 정보 추가</h2>
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

        <fieldset className="mt-3">
          <legend className="text-caption font-semibold text-muted">정기휴무일 (여러 개 선택)</legend>
          <div className="mt-1 flex gap-[3px]" role="group" aria-label="정기휴무일">
            {DAY_CHARS.map((d) => {
              const on = days.has(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={`flex h-11 min-w-11 flex-1 cursor-pointer items-center justify-center rounded-full border text-label font-bold max-[359px]:min-w-0 max-[359px]:rounded-xl ${
                    on ? "border-danger bg-danger text-white" : "border-line bg-bg text-ink"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-caption font-semibold text-muted">영업시간</span>
            <input
              ref={firstRef}
              value={hours}
              onChange={(e) => setHours(formatRange(e.target.value))}
              inputMode="numeric"
              maxLength={11}
              placeholder="11:00~21:00"
              className={`mt-1 ${input}`}
            />
          </label>
          <label className="block">
            <span className="text-caption font-semibold text-muted">브레이크타임</span>
            <input
              value={brk}
              onChange={(e) => setBrk(formatRange(e.target.value))}
              inputMode="numeric"
              maxLength={11}
              placeholder="15:00~17:00"
              className={`mt-1 ${input}`}
            />
          </label>
        </div>
        <p className="mt-1 text-caption text-muted">숫자만 눌러도 시간 형식으로 채워져요. 비우면 삭제돼요.</p>

        <label className="mt-3 block">
          <span className="text-caption font-semibold text-muted">현장 한 줄 팁</span>
          <input
            value={tip}
            onChange={(e) => setTip(e.target.value)}
            maxLength={TIP_MAX}
            placeholder="예: 주차 3대 가능, 점심엔 웨이팅 있음, 제육 추천"
            className={`mt-1 ${input}`}
          />
          <span className="mt-0.5 block text-right text-caption text-muted tnum">
            {tip.length}/{TIP_MAX}
          </span>
        </label>

        <p className="mt-1 min-h-5 text-caption text-danger" role="alert">
          {error}
        </p>

        <button
          type="submit"
          disabled={busy}
          className="mt-1 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-cta text-label font-bold text-on-cta disabled:opacity-60"
        >
          {busy ? "등록 중…" : "등록하기"}
        </button>
        <p className="mt-2 text-center text-caption text-muted">
          등록한 정보는 이 앱을 쓰는 모든 기기에 공유돼요. 링크·연락처는 넣을 수 없어요.
        </p>
      </form>
    </div>
  );
}
