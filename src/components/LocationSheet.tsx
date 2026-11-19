"use client";

import { useModalHistory } from "@/lib/useModalHistory";
import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Search, X } from "lucide-react";
import { HUBS } from "@/data/places";

export interface PickedLocation {
  name: string;
  lat: number;
  lng: number;
}

interface Result extends PickedLocation {
  address: string;
}

export default function LocationSheet({
  onClose,
  onSelect,
  onUseGps,
}: {
  onClose: () => void;
  onSelect: (loc: PickedLocation) => void;
  onUseGps: () => Promise<boolean>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useModalHistory(onClose);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(term)}`);
      const data = (await res.json()) as { results?: Result[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "검색 실패");
      setResults(data.results ?? []);
    } catch (err) {
      setResults(null);
      setMessage(err instanceof Error ? err.message : "검색에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function useGps() {
    setBusy(true);
    setMessage(null);
    const ok = await onUseGps();
    setBusy(false);
    if (ok) onClose();
    else setMessage("위치 권한이 없어 GPS를 쓸 수 없어요. 동네 이름으로 검색해 주세요.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
      <button
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="동네 설정"
        className="sheet-up relative w-full max-w-md rounded-t-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-sticky"
      >
        <div className="sheet-grabber" aria-hidden />
        <div className="flex items-center justify-between">
          <h2 className="text-title2 font-bold tracking-[-0.02em]">동네 설정</h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <form onSubmit={search} className="mt-3 flex gap-2">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={50}
            placeholder="동네·역 이름 (예: 성수역)"
            aria-label="동네 또는 역 이름 검색"
            className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-body text-ink placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || !q.trim()}
            className="flex min-h-[44px] cursor-pointer items-center gap-1 rounded-xl bg-primary px-4 text-label font-bold text-on-primary disabled:opacity-50"
          >
            <Search size={16} aria-hidden />
            검색
          </button>
        </form>

        <button
          onClick={useGps}
          disabled={busy}
          className="mt-2 flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line text-label font-semibold text-primary disabled:opacity-50"
        >
          <LocateFixed size={16} aria-hidden />
          현재 위치(GPS)로 보기
        </button>

        <p className="mt-2 min-h-5 text-caption text-danger" role="alert">
          {message}
        </p>

        <div className="max-h-[40dvh] overflow-y-auto">
          {results ? (
            results.length === 0 ? (
              <p className="py-6 text-center text-body text-muted">검색 결과가 없어요.</p>
            ) : (
              <ul>
                {results.map((r) => (
                  <li key={`${r.lat},${r.lng},${r.name}`}>
                    <button
                      onClick={() => onSelect({ name: r.name, lat: r.lat, lng: r.lng })}
                      className="flex min-h-[44px] w-full cursor-pointer items-start gap-2 border-b border-line py-2.5 text-left"
                    >
                      <MapPin size={16} className="mt-1 shrink-0 text-primary" aria-hidden />
                      <span>
                        <span className="block text-body font-semibold">{r.name}</span>
                        <span className="block text-caption text-muted">{r.address}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div>
              <p className="text-caption font-semibold text-muted">서울·경기 주요 거점</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {HUBS.map((h) => (
                  <button
                    key={h.name}
                    onClick={() => onSelect(h)}
                    className="min-h-[44px] cursor-pointer rounded-full border border-line bg-bg px-4 text-label font-semibold"
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
