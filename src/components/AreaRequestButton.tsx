"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, MapPinPlus } from "lucide-react";
import { areaCell } from "@/lib/areaCell";
import {
  getRequestedRaw,
  getRequestedRawServer,
  isRequested,
  markRequested,
  subscribeRequested,
} from "@/lib/areaRequests";
import { showToast } from "@/lib/toast";

/**
 * 미지원 지역(가장 가까운 거점 30km 밖) 배너 아래의 '이 동네 데이터 요청하기' 버튼.
 * 서버가 좌표를 0.02° 격자 중심으로 줄여 저장하므로 정확한 위치는 남지 않는다. 성공·중복 모두 '요청 접수됨'으로 바꾼다.
 */
export default function AreaRequestButton({ lat, lng }: { lat: number; lng: number }) {
  const cell = areaCell(lat, lng);
  const raw = useSyncExternalStore(subscribeRequested, getRequestedRaw, getRequestedRawServer);
  const done = isRequested(raw, cell.key);
  const [busy, setBusy] = useState(false);

  async function request() {
    if (done || busy) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showToast("오프라인 상태에서는 요청할 수 없어요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/area-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, website: "" }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; cellKey?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "요청에 실패했어요.");
      markRequested(data.cellKey ?? cell.key);
      showToast("요청 고마워요! 지역을 넓힐 때 참고할게요.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "요청에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={request}
      disabled={done || busy}
      aria-live="polite"
      className={`theme-t flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-center text-label font-semibold disabled:cursor-default ${
        done ? "border-line bg-surface text-muted" : "cursor-pointer border-line bg-surface text-ink active:opacity-80"
      }`}
    >
      {done ? <Check size={16} className="shrink-0" aria-hidden /> : <MapPinPlus size={16} className="shrink-0" aria-hidden />}
      <span className="min-w-0">{done ? "요청 접수됨 · 고마워요" : busy ? "보내는 중…" : "이 동네 데이터 요청하기"}</span>
    </button>
  );
}
