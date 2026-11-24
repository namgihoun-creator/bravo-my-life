"use client";

import { useEffect, useState } from "react";
import { useModalHistory } from "@/lib/useModalHistory";
import { EllipsisVertical, PlusSquare, Share, X } from "lucide-react";
import { dismissInstallBar, promptInstall, useInstallBarDismissed, useInstallState } from "@/lib/install";

const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * 최상단 슬림 바로가기 추가 바(48px). 설치된 앱(standalone)이거나 이번 세션에서 닫았다면 그리지 않는다.
 * '추가': 저장된 beforeinstallprompt 가 있으면 기본 설치 다이얼로그, 없으면 OS별 안내 시트.
 */
export default function InstallBar() {
  const { installed } = useInstallState();
  const dismissed = useInstallBarDismissed();
  const [open, setOpen] = useState(false);

  useModalHistory(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onInstall = async () => {
    if (!(await promptInstall())) setOpen(true);
  };

  return (
    <>
      {!installed && !dismissed && (
        <div
          role="region"
          aria-label="바로가기 추가 안내"
          className="install-bar theme-t flex h-12 w-full min-w-0 items-center gap-2 border-b border-[var(--ib-line)] bg-[var(--ib-bg)] pl-4 pr-3 max-[359px]:gap-1.5 max-[359px]:px-2.5"
        >
          <span
            aria-hidden
            className="theme-t flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--ib-accent)] text-[13px] font-extrabold leading-none text-[var(--ib-accent-fg)]"
          >
            B
          </span>
          <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium text-[var(--ib-text)] max-[359px]:text-[12px]">
            홈 화면에 바로가기 추가
          </p>
          <button
            type="button"
            onClick={dismissInstallBar}
            className="flex min-h-[44px] shrink-0 cursor-pointer items-center whitespace-nowrap px-[10px] text-[13px] font-medium text-[var(--ib-sub)] active:opacity-70 max-[359px]:px-1.5 max-[359px]:text-[12px]"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={onInstall}
            className="flex min-h-[44px] shrink-0 cursor-pointer items-center active:opacity-80"
          >
            <span className="flex h-8 items-center whitespace-nowrap theme-t rounded-full bg-[var(--ib-accent)] px-[14px] text-[13px] font-semibold leading-none text-[var(--ib-accent-fg)] max-[359px]:px-3 max-[359px]:text-[12px]">
              추가
            </span>
          </button>
        </div>
      )}
      {open && <InstallSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-caption font-extrabold text-on-primary">
        {n}
      </span>
      <span className="flex-1 text-body text-ink">{children}</span>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg text-primary" aria-hidden>
        {icon}
      </span>
    </li>
  );
}

function InstallSheet({ onClose }: { onClose: () => void }) {
  const ios = isIos();
  const android = (
    <section key="android" aria-label="안드로이드 추가 방법">
      <h3 className="text-label font-bold text-ink">안드로이드 (크롬)</h3>
      <ol className="mt-2 space-y-2.5">
        <Step n={1} icon={<EllipsisVertical size={18} />}>
          우측 상단 <b>⋮</b> 메뉴 누르기
        </Step>
        <Step n={2} icon={<PlusSquare size={18} />}>
          <b>홈 화면에 추가</b> → <b>추가</b>(또는 설치)
        </Step>
      </ol>
    </section>
  );
  const iphone = (
    <section key="iphone" aria-label="아이폰 추가 방법">
      <h3 className="text-label font-bold text-ink">아이폰 (Safari)</h3>
      <ol className="mt-2 space-y-2.5">
        <Step n={1} icon={<Share size={18} />}>
          하단 <b>공유 버튼(□↑)</b> 누르기
        </Step>
        <Step n={2} icon={<PlusSquare size={18} />}>
          <b>홈 화면에 추가</b> 누르기
        </Step>
      </ol>
    </section>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button aria-label="닫기" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="바로가기 추가 안내"
        className="sheet-up relative w-full max-w-md rounded-t-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-sticky"
      >
        <div className="sheet-grabber" aria-hidden />
        <div className="flex items-center justify-between">
          <h2 className="text-title2 font-bold tracking-[-0.02em]">홈 화면에 바로가기 추가</h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-label text-muted">앱스토어 설치가 아니에요. 스마트폰 바탕화면에 바로 열 수 있는 아이콘을 추가해요. 2단계면 끝나요.</p>

        <div className="mt-4 space-y-5">{ios ? [iphone, android] : [android, iphone]}</div>

        <button
          onClick={onClose}
          className="theme-t mt-5 min-h-[48px] w-full cursor-pointer rounded-xl bg-primary text-label font-bold text-on-primary active:opacity-90"
        >
          확인했어요
        </button>
      </div>
    </div>
  );
}
