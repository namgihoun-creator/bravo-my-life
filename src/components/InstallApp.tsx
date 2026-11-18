"use client";

import { useEffect, useState } from "react";
import { EllipsisVertical, PlusSquare, Share, X } from "lucide-react";
import { dismissInstallBar, promptInstall, useInstallBarDismissed, useInstallState } from "@/lib/install";

const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * 최상단 슬림 앱 설치 바(48px). 설치된 앱(standalone)이거나 이번 세션에서 닫았다면 그리지 않는다.
 * '설치': 저장된 beforeinstallprompt 가 있으면 기본 설치 다이얼로그, 없으면 OS별 안내 시트.
 */
export default function InstallBar() {
  const { installed } = useInstallState();
  const dismissed = useInstallBarDismissed();
  const [open, setOpen] = useState(false);

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
          aria-label="앱 설치 안내"
          className="flex h-12 w-full items-center gap-2 border-b border-[#DBEAFE] bg-[#EFF6FF] pl-4 pr-1"
        >
          <span
            aria-hidden
            className="h-[26px] w-[26px] shrink-0 rounded-md bg-cover bg-center"
            style={{ backgroundImage: "url(/icons/icon-192.png)" }}
          />
          <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium text-[#1E293B]">
            앱으로 설치해 더 빠르게 열기
          </p>
          <button
            type="button"
            onClick={onInstall}
            className="flex min-h-[44px] shrink-0 cursor-pointer items-center px-1 active:opacity-80"
          >
            <span className="rounded-full bg-[#1D4ED8] px-3.5 py-1.5 text-[13px] font-semibold leading-none text-white">
              설치
            </span>
          </button>
          <button
            type="button"
            onClick={dismissInstallBar}
            aria-label="설치 안내 닫기"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center text-[#475569]"
          >
            <X size={18} aria-hidden />
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
    <section key="android" aria-label="안드로이드 설치 방법">
      <h3 className="text-label font-bold text-ink">안드로이드 (크롬)</h3>
      <ol className="mt-2 space-y-2.5">
        <Step n={1} icon={<EllipsisVertical size={18} />}>
          우측 상단 <b>⋮</b> 메뉴 누르기
        </Step>
        <Step n={2} icon={<PlusSquare size={18} />}>
          <b>홈 화면에 추가</b> → <b>설치</b>
        </Step>
      </ol>
    </section>
  );
  const iphone = (
    <section key="iphone" aria-label="아이폰 설치 방법">
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
        aria-label="앱 설치 안내"
        className="sheet-up relative w-full max-w-md rounded-t-2xl bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-sticky"
      >
        <div className="sheet-grabber" aria-hidden />
        <div className="flex items-center justify-between">
          <h2 className="text-title2 font-bold tracking-[-0.02em]">홈 화면에 앱 설치</h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-label text-muted">설치하면 주소창 없이 바로 열려요. 2단계면 끝나요.</p>

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
