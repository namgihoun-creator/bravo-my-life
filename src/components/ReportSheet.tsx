"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LocateFixed, MapPin, Search, X } from "lucide-react";
import { REPORT_CATEGORIES, type Mode } from "@/data/places";

interface Picked {
  label: string;
  lat: number;
  lng: number;
}

interface Result extends Picked {
  name: string;
  address: string;
}

const MODES: { key: Mode; label: string }[] = [
  { key: "survival", label: "긴급 생존" },
  { key: "nopo", label: "찐노포" },
];

export default function ReportSheet({
  defaultMode,
  onClose,
  onDone,
  getPosition,
}: {
  defaultMode: Mode;
  onClose: () => void;
  onDone: () => void;
  getPosition: () => Promise<{ lat: number; lng: number } | null>;
}) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [category, setCategory] = useState(REPORT_CATEGORIES[defaultMode][0].key);
  const [name, setName] = useState("");
  const [tip, setTip] = useState("");
  const [website, setWebsite] = useState(""); // 허니팟
  const [picked, setPicked] = useState<Picked | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changeMode = (m: Mode) => {
    setMode(m);
    setCategory(REPORT_CATEGORIES[m][0].key);
  };

  async function useGps() {
    setError(null);
    setSearching(true);
    const p = await getPosition();
    setSearching(false);
    if (!p) return setError("위치 권한이 없어 GPS를 쓸 수 없어요. 주소로 검색해 주세요.");
    setPicked({ label: "현재 GPS 위치", ...p });
    setResults(null);
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setError(null);
    setSearching(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(term)}`);
      const data = (await res.json()) as { results?: Result[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "검색 실패");
      setResults(data.results ?? []);
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : "검색에 실패했어요.");
    } finally {
      setSearching(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("장소명을 2자 이상 입력해 주세요.");
    if (!picked) return setError("위치를 선택해 주세요. (GPS 또는 주소 검색)");
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/places/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          category,
          name,
          tip,
          lat: picked.lat,
          lng: picked.lng,
          website,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "제보에 실패했어요.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "제보에 실패했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  const input =
    "min-h-[44px] w-full rounded-xl border border-line bg-bg px-3 text-body text-ink placeholder:text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
      <button aria-label="닫기" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="장소 제보"
        className="sheet-up relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-sticky"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-title2 font-bold tracking-[-0.02em]">우리 동네 장소 제보</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <fieldset className="mt-3">
          <legend className="text-caption font-semibold text-muted">모드</legend>
          <div className="mt-1 grid grid-cols-2 gap-1 rounded-[14px] border border-line bg-bg p-1">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={mode === m.key}
                onClick={() => changeMode(m.key)}
                className={`min-h-[44px] cursor-pointer rounded-[10px] text-label font-bold ${
                  mode === m.key ? "bg-primary text-on-primary" : "text-muted"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-3">
          <legend className="text-caption font-semibold text-muted">카테고리</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {REPORT_CATEGORIES[mode].map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={category === c.key}
                onClick={() => setCategory(c.key)}
                className={`min-h-[44px] cursor-pointer rounded-full border px-4 text-label font-semibold ${
                  category === c.key
                    ? "border-primary bg-primary text-on-primary"
                    : "border-line bg-bg text-ink"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-3 block">
          <span className="text-caption font-semibold text-muted">장소명</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="예: 원미식당"
            className={`mt-1 ${input}`}
          />
        </label>

        <div className="mt-3">
          <span className="text-caption font-semibold text-muted">위치</span>
          {picked && (
            <p className="mt-1 flex items-center gap-1 text-label font-semibold text-primary">
              <Check size={16} aria-hidden />
              {picked.label}
            </p>
          )}
          <button
            type="button"
            onClick={useGps}
            disabled={searching}
            className="mt-1 flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line text-label font-semibold text-primary disabled:opacity-50"
          >
            <LocateFixed size={16} aria-hidden />
            현재 GPS 위치 사용
          </button>
          <div className="mt-2 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(e)}
              maxLength={50}
              placeholder="동네·주소·건물명 검색"
              aria-label="위치 검색"
              className={`min-w-0 flex-1 ${input}`}
            />
            <button
              type="button"
              onClick={search}
              disabled={searching || !q.trim()}
              className="flex min-h-[44px] cursor-pointer items-center gap-1 rounded-xl border border-primary px-4 text-label font-bold text-primary disabled:opacity-50"
            >
              <Search size={16} aria-hidden />
              검색
            </button>
          </div>
          {results && (
            <ul className="mt-1 max-h-[28dvh] overflow-y-auto">
              {results.length === 0 && (
                <li className="py-3 text-center text-body text-muted">검색 결과가 없어요.</li>
              )}
              {results.map((r) => (
                <li key={`${r.lat},${r.lng},${r.name}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked({ label: `${r.name} · ${r.address}`, lat: r.lat, lng: r.lng });
                      setResults(null);
                    }}
                    className="flex min-h-[44px] w-full cursor-pointer items-start gap-2 border-b border-line py-2 text-left"
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
          )}
        </div>

        <label className="mt-3 block">
          <span className="text-caption font-semibold text-muted">한 줄 팁 (선택)</span>
          <input
            value={tip}
            onChange={(e) => setTip(e.target.value)}
            maxLength={60}
            placeholder={mode === "survival" ? "예: 24시간 운영, 건조기 4대 있음" : "예: 30년 된 순대국밥집"}
            className={`mt-1 ${input}`}
          />
          <span className="mt-0.5 block text-right text-caption text-muted tnum">{tip.length}/60</span>
        </label>

        {/* 허니팟: 화면에 보이지 않고 접근성 트리에서도 제외 */}
        <input
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          name="website"
          className="absolute -left-[9999px] h-0 w-0 opacity-0"
        />

        <p className="mt-1 min-h-5 text-caption text-danger" role="alert">
          {error}
        </p>

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-cta text-label font-bold text-on-cta disabled:opacity-60"
        >
          {submitting ? "제보 중…" : "제보하기"}
        </button>
        <p className="mt-2 text-center text-caption text-muted">
          링크·연락처는 제보에 넣을 수 없어요. 제보한 장소는 #유저제보 태그로 표시돼요.
        </p>
      </form>
    </div>
  );
}
