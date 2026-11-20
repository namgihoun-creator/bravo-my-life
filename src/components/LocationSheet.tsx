"use client";

import { useModalHistory } from "@/lib/useModalHistory";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LocateFixed, MapPin, Search, X } from "lucide-react";
import { HUBS, HUB_GROUPS } from "@/data/places";
import {
  forgetPlace,
  getRecentRaw,
  getRecentRawServer,
  parseRecent,
  rememberPlace,
  subscribeRecent,
} from "@/lib/recentPlaces";

export interface PickedLocation {
  name: string;
  lat: number;
  lng: number;
}

interface Result extends PickedLocation {
  address: string;
}

/** 권역별 거점 묶음(모듈 상수라 렌더마다 다시 계산하지 않는다). 어느 권역에도 없는 거점은 '기타'로 뒤에 붙는다. */
const hubSections = (() => {
  const byName = new Map(HUBS.map((h) => [h.name, h]));
  const used = new Set<string>();
  const sections = HUB_GROUPS.map((g) => ({
    label: g.label,
    hubs: g.names.flatMap((n) => {
      const h = byName.get(n);
      if (!h) return [];
      used.add(n);
      return [h];
    }),
  })).filter((s) => s.hubs.length > 0);
  const rest = HUBS.filter((h) => !used.has(h.name));
  return rest.length > 0 ? [...sections, { label: "기타", hubs: rest }] : sections;
})();

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

  const recentRaw = useSyncExternalStore(subscribeRecent, getRecentRaw, getRecentRawServer);
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);

  // 시트에서 직접 고른 동네만 저장한다(최근 3곳)
  function choose(loc: PickedLocation) {
    rememberPlace(loc);
    onSelect(loc);
  }

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

        {recent.length > 0 && (
          <div className="mt-3">
            <p className="text-caption font-semibold text-muted">최근·자주 가는 동네</p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {recent.map((r) => (
                <li
                  key={r.name}
                  className="flex min-w-0 max-w-full items-center rounded-full border border-primary bg-tag-bg"
                >
                  <button
                    onClick={() => choose(r)}
                    className="flex min-h-[44px] min-w-0 cursor-pointer items-center gap-1 pl-3 pr-1 text-label font-semibold text-primary"
                  >
                    <MapPin size={14} className="shrink-0" aria-hidden />
                    <span className="truncate">{r.name}</span>
                  </button>
                  <button
                    onClick={() => forgetPlace(r.name)}
                    aria-label={`${r.name} 목록에서 지우기`}
                    className="flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted"
                  >
                    <X size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={useGps}
          disabled={busy}
          className="mt-3 flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line text-label font-semibold text-primary disabled:opacity-50"
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
                      onClick={() => choose({ name: r.name, lat: r.lat, lng: r.lng })}
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
              {hubSections.map((s) => (
                <section key={s.label} className="mt-3" aria-label={s.label}>
                  <h3 className="text-caption font-bold text-ink">{s.label}</h3>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {s.hubs.map((h) => (
                      <button
                        key={h.name}
                        onClick={() => choose(h)}
                        className="min-h-[44px] cursor-pointer rounded-full border border-line bg-bg px-4 text-label font-semibold"
                      >
                        {h.name}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
