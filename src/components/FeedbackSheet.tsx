"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Frown, Lightbulb, MessageSquare, ThumbsUp, X } from "lucide-react";
import { useModalHistory } from "@/lib/useModalHistory";
import { showToast } from "@/lib/toast";

const MAX = 140;
type Kind = "like" | "pain" | "idea";
const KINDS: { key: Kind; label: string; Icon: typeof ThumbsUp }[] = [
  { key: "like", label: "좋아요", Icon: ThumbsUp },
  { key: "pain", label: "불편해요", Icon: Frown },
  { key: "idea", label: "아이디어", Icon: Lightbulb },
];

function Sheet({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useModalHistory(onClose);
  useEffect(() => {
    // 위치 시트 안에서 열린 경우 Esc 가 아래 시트까지 닫지 않도록 캡처 단계에서 먼저 처리하고 전파를 끊는다
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const ready = kind !== null && text.trim().length >= 2 && !busy;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setMsg("오프라인 상태에서는 보낼 수 없어요.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const mode = document.documentElement.dataset.mode;
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          message: text,
          mode: mode === "nopo" ? "nopo" : "survival",
          path: location.pathname.startsWith("/place/") ? "/place" : location.pathname, // 상세 장소 id 는 남기지 않는다
          website: String(new FormData(e.currentTarget).get("website") ?? ""),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "보내지 못했어요.");
      showToast("의견 고마워요! 꼼꼼히 읽어 볼게요.");
      onClose();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "보내지 못했어요. 잠시 후 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" role="presentation">
      <button aria-label="닫기" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="앱 의견 보내기"
        className="sheet-up relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-sticky"
      >
        <div className="sheet-grabber" aria-hidden />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-title2 font-bold tracking-[-0.02em]">앱 의견 보내기</h2>
            <p className="mt-0.5 text-caption text-muted">써 보면서 느낀 점을 한 줄로 알려 주세요</p>
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

        <form onSubmit={submit} className="mt-3">
          <div role="group" aria-label="의견 종류" className="grid grid-cols-3 gap-2">
            {KINDS.map(({ key, label, Icon }) => {
              const on = kind === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setKind(key)}
                  className={`theme-t flex min-h-[44px] min-w-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-2 text-label font-semibold max-[359px]:px-1 max-[359px]:text-[13px] ${
                    on ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink"
                  }`}
                >
                  <Icon size={16} aria-hidden className="max-[359px]:hidden" />
                  {label}
                </button>
              );
            })}
          </div>

          <label htmlFor="feedback-text" className="mt-3 block text-caption font-semibold text-muted">
            한 줄 의견
          </label>
          <input
            id="feedback-text"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            maxLength={MAX}
            placeholder="예: 길찾기 버튼이 더 컸으면 좋겠어요"
            autoComplete="off"
            enterKeyHint="send"
            className="mt-1 h-11 w-full min-w-0 rounded-xl border border-line bg-bg px-3 text-[14px] text-ink placeholder:text-muted focus:border-primary"
          />
          {/* 허니팟: 사람에게는 보이지 않는다 */}
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute left-[-9999px] h-0 w-0 opacity-0" />
          <p className="tnum mt-1 text-right text-caption text-muted">
            {text.length}/{MAX}
          </p>
          <p className="text-caption text-muted">이름·연락처는 받지 않아요. 링크·전화번호는 적지 마세요.</p>

          {msg && (
            <p role="alert" className="mt-2 text-caption font-semibold text-danger">
              {msg}
            </p>
          )}
          <button
            type="submit"
            disabled={!ready}
            className="mt-3 min-h-[48px] w-full cursor-pointer rounded-xl bg-primary px-4 text-label font-bold text-on-primary active:opacity-90 disabled:cursor-default disabled:opacity-40"
          >
            {busy ? "보내는 중…" : "보내기"}
          </button>
        </form>
      </div>
    </div>
  );
}

/** '앱 의견 보내기' 트리거 + 시트. 푸터(서버 컴포넌트)·위치 시트 어디서든 이 컴포넌트 하나만 놓으면 된다. */
export default function FeedbackButton({
  className,
  children,
  withIcon = false,
}: {
  className: string;
  children?: ReactNode;
  withIcon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {withIcon && <MessageSquare size={16} aria-hidden />}
        {children ?? "앱 의견 보내기"}
      </button>
      {open && createPortal(<Sheet onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
