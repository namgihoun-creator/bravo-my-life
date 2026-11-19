"use client";

import { useModalHistory } from "@/lib/useModalHistory";
import { useEffect, useRef, useState } from "react";
import { Copy, HeartHandshake, Link2Off, Sparkles, X } from "lucide-react";
import { CODE_RE, connectCouple, disconnectCouple, generateCode, normalizeCode, useCouple } from "@/lib/couple";
import { showToast } from "@/lib/toast";

/** 커플 공유 코드 바텀 시트: 코드 입력·연동, 새 코드 자동 생성, 연동 중 코드 표시·해제 */
export default function CoupleSheet({ onClose }: { onClose: () => void }) {
  const { code, busy } = useCouple();
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const norm = normalizeCode(input);
  const valid = CODE_RE.test(norm);

  useModalHistory(onClose);
  useEffect(() => {
    if (!code) inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, code]);

  async function connect(raw: string, created = false) {
    setWorking(true);
    setMessage(null);
    const res = await connectCouple(raw);
    setWorking(false);
    if (res.ok) {
      setInput("");
      showToast(
        created
          ? `새 코드 ${normalizeCode(raw)}로 연동했어요. 상대방에게 이 코드를 알려 주세요.`
          : `코드 ${normalizeCode(raw)}로 연동했어요. 찜·다녀온 곳이 함께 맞춰져요.`,
      );
    } else if (res.reason === "format") {
      setMessage("영문·숫자 4~8자리로 입력해 주세요.");
    } else {
      setMessage("서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showToast("코드를 복사했어요.");
    } catch {
      showToast(`코드: ${code}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button aria-label="닫기" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="커플 코드 연동"
        className="sheet-up relative w-full max-w-md rounded-t-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-sticky"
      >
        <div className="sheet-grabber" aria-hidden />
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-title2 font-bold tracking-[-0.02em]">
            <HeartHandshake size={20} strokeWidth={2} className="text-primary" aria-hidden />
            커플 코드 연동
          </h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        {code ? (
          <>
            <p className="mt-1 text-label text-muted">연동 중이에요. 두 폰의 찜·다녀온 곳이 실시간으로 맞춰져요.</p>
            <div className="mt-4 rounded-xl border border-line bg-bg px-4 py-3 text-center">
              <p className="text-caption font-semibold text-muted">현재 연결된 코드</p>
              <p className="tnum mt-0.5 text-[28px] font-extrabold tracking-[0.12em] text-primary" aria-label={`코드 ${code}`}>
                {code}
              </p>
              {busy && <p className="text-caption text-muted">맞추는 중…</p>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={copy}
                className="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-surface px-4 text-label font-semibold text-ink"
              >
                <Copy size={14} strokeWidth={2} aria-hidden />
                코드 복사
              </button>
              <button
                onClick={() => {
                  disconnectCouple();
                  showToast("연동을 해제했어요. 이 폰의 찜·다녀온 곳은 그대로예요.");
                }}
                className="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-danger px-4 text-label font-semibold text-danger"
              >
                <Link2Off size={14} strokeWidth={2} aria-hidden />
                연동 해제
              </button>
            </div>
            <p className="mt-3 text-caption text-muted">해제하면 동기화만 멈춰요. 서버에 저장된 내용은 같은 코드로 다시 연결하면 돌아와요.</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-label text-muted">
              같은 코드를 입력한 두 스마트폰이 찜·다녀온 곳(한 줄 메모)을 실시간으로 맞춰요. 로그인은 필요 없어요.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) void connect(input);
              }}
              className="mt-4 flex gap-2"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
                  setMessage(null);
                }}
                maxLength={8}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="예: 1004"
                aria-label="커플 코드 (영문·숫자 4~8자리)"
                className="tnum h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-body font-bold tracking-[0.08em] text-ink placeholder:font-normal placeholder:tracking-normal placeholder:text-muted"
              />
              <button
                type="submit"
                disabled={!valid || working}
                className="min-h-[44px] shrink-0 cursor-pointer whitespace-nowrap rounded-xl bg-primary px-4 text-label font-bold text-on-primary disabled:opacity-50"
              >
                {working ? "연결 중…" : "연동하기"}
              </button>
            </form>
            {message && (
              <p role="alert" className="mt-2 text-caption font-semibold text-danger">
                {message}
              </p>
            )}
            <button
              onClick={() => void connect(generateCode(), true)}
              disabled={working}
              className="mt-3 inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary text-label font-semibold text-primary disabled:opacity-50"
            >
              <Sparkles size={14} strokeWidth={2} aria-hidden />새 코드 자동 생성
            </button>
            <p className="mt-3 text-caption text-muted">
              코드를 아는 사람은 누구나 이 코드의 찜·메모를 볼 수 있어요. 4자리는 추측하기 쉬우니 자동 생성(6자리)을 권해요.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
