"use client";

import { readLlmHours, getOpenState } from "@/lib/openStatus";
import { useMinuteClock } from "@/lib/useMinuteClock";
import type { Place } from "@/data/places";

/**
 * 상세 페이지의 영업 상태 슬롯(클라이언트): 서버 캐시된 페이지에 시각 의존 값이 들어가지 않게 분리했다.
 * 공식 값이 있으면 상태만, 블로그(LLM) 추정이면 영업시간·휴무일과 함께 '블로그 기준 추정'을 명시한다. 값이 없으면 통째로 숨긴다.
 */
export default function PlaceHours({ place }: { place: Place }) {
  const nowMs = useMinuteClock(); // 서버·하이드레이션 단계에서는 0 → 상태 줄은 마운트 후에만 그린다
  const raw = readLlmHours(place);
  // readLlmHours 는 이미 형식을 검증했지만 타입은 unknown 이라 여기서 좁힌다
  const llm = raw
    ? {
        hours: typeof raw.hours === "string" ? raw.hours : null,
        break_time: typeof raw.break_time === "string" ? raw.break_time : null,
        closed_days: Array.isArray(raw.closed_days) ? raw.closed_days.filter((d): d is string => typeof d === "string") : [],
      }
    : null;
  const open = nowMs > 0 ? getOpenState(place, nowMs) : null;
  const isLlm = open ? !!open.isLlm : !!llm;
  const tone = open?.status ? "success" : "danger";
  const text = open?.status ? open.label : open?.reason;
  // 그릴 내용(상태 줄 또는 블로그 추정 목록)이 하나도 없으면 빈 테두리 박스를 남기지 않고 통째로 숨긴다
  if (!(open && text) && !(llm && isLlm)) return null;

  return (
    <section aria-label="영업 상태" className="mt-3 rounded-xl border border-line bg-bg p-3">
      {open && text && (
        <p className={`flex min-w-0 items-center gap-1.5 text-label font-bold ${tone === "success" ? "text-success" : "text-danger"}`}>
          <span
            aria-hidden
            className={`shrink-0 rounded-full ${
              isLlm ? `h-2.5 w-2.5 border-2 bg-transparent ${tone === "success" ? "border-success" : "border-danger"}` : `h-2 w-2 ${tone === "success" ? "bg-success" : "bg-danger"}`
            }`}
          />
          <span className="min-w-0">{isLlm ? `${text} · 블로그 기준` : text}</span>
        </p>
      )}
      {llm && isLlm && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {llm.hours && <li className="tnum rounded-md border border-line bg-surface px-2 py-0.5 text-caption font-semibold text-ink">영업 {llm.hours}</li>}
          {llm.break_time && (
            <li className="tnum rounded-md border border-line bg-surface px-2 py-0.5 text-caption font-semibold text-ink">브레이크 {llm.break_time}</li>
          )}
          {llm.closed_days.length > 0 && (
            <li className="rounded-md border border-danger px-2 py-0.5 text-caption font-semibold text-danger">정기휴무 {llm.closed_days.join("·")}</li>
          )}
        </ul>
      )}
      {isLlm && (
        <p className="mt-2 text-caption text-muted">블로그 후기를 바탕으로 한 추정이에요. 방문 전 가게에 확인해 주세요.</p>
      )}
    </section>
  );
}
