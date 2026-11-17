"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import {
  NAV_APPS,
  openNavigation,
  useNavApp,
  type NavApp,
  type NavOrigin,
  type NavTarget,
} from "@/lib/navigation";

const meta = (app: NavApp) => NAV_APPS.find((a) => a.key === app) ?? NAV_APPS[0];

/** 앱 구분용 작은 점(브랜드 색 원 + 이니셜) */
function AppDot({ app }: { app: NavApp }) {
  return (
    <span aria-hidden className={`nav-dot nav-dot-${app}`}>
      {meta(app).short}
    </span>
  );
}

function NavAppSheet({
  current,
  target,
  origin,
  onSelect,
  onClose,
}: {
  current: NavApp;
  target: NavTarget;
  origin?: NavOrigin;
  onSelect: (app: NavApp) => void;
  onClose: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-end justify-center" role="presentation">
      <button aria-label="닫기" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="길찾기 앱 선택"
        className="sheet-up relative w-full max-w-md rounded-t-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-sticky"
      >
        <div className="sheet-grabber" aria-hidden />
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-title2 font-bold tracking-[-0.02em]">길찾기 앱 선택</h2>
            <p className="mt-0.5 text-caption text-muted">
              고른 앱이 기본 길찾기 앱으로 저장되고, 모든 카드에 바로 적용돼요.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <ul className="mt-3 space-y-2">
          {NAV_APPS.map((a) => {
            const active = a.key === current;
            return (
              <li key={a.key} className="flex items-stretch gap-2">
                {/* 선택만 바꾸기 */}
                <button
                  ref={active ? firstRef : undefined}
                  onClick={() => {
                    onSelect(a.key);
                    onClose();
                  }}
                  aria-pressed={active}
                  className={`flex min-h-[52px] flex-1 cursor-pointer items-center gap-3 rounded-xl border px-3 text-left text-body font-bold ${
                    active ? "border-primary bg-tag-bg text-ink" : "border-line bg-bg text-ink"
                  }`}
                >
                  <AppDot app={a.key} />
                  <span className="flex-1">{a.label}</span>
                  {active && (
                    <span className="flex items-center gap-0.5 text-caption font-bold text-primary">
                      <Check size={14} aria-hidden />
                      기본
                    </span>
                  )}
                </button>
                {/* 선택하고 바로 길안내 */}
                <button
                  onClick={() => {
                    onSelect(a.key);
                    onClose();
                    openNavigation(a.key, target, origin);
                  }}
                  aria-label={`${a.label} 바로 길안내`}
                  className="min-h-[52px] shrink-0 cursor-pointer rounded-xl border border-primary px-3 text-label font-bold text-primary"
                >
                  바로 안내
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 분할 길찾기 버튼.
 * - 왼쪽: 선택된 앱으로 즉시 길안내
 * - 오른쪽 ▾: 앱 선택 시트 (선택만 바꾸기 / 선택하고 바로 안내)
 * 선택값은 전역(localStorage)이라 한 곳에서 바꾸면 모든 카드가 즉시 바뀐다.
 */
export default function NavigationButton({ target, origin }: { target: NavTarget; origin?: NavOrigin }) {
  const [app, setApp] = useNavApp();
  const [open, setOpen] = useState(false);
  const label = `${meta(app).label} 길찾기`;

  return (
    <>
      <div className={`nav-btn nav-btn-${app} theme-t mt-3 flex h-12 w-full overflow-hidden rounded-xl`}>
        <button
          onClick={() => openNavigation(app, target, origin)}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 text-label font-bold active:opacity-90"
        >
          <AppDot app={app} />
          <span className="truncate">{label}</span>
        </button>
        <button
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="길찾기 앱 선택"
          className="nav-btn-arrow flex w-12 shrink-0 cursor-pointer items-center justify-center active:opacity-90"
        >
          <ChevronDown size={18} aria-hidden />
        </button>
      </div>
      {open && (
        <NavAppSheet
          current={app}
          target={target}
          origin={origin}
          onSelect={setApp}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
