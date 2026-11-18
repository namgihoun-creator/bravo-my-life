"use client";

import { useEffect, useState } from "react";
import { Download, EllipsisVertical, PlusSquare, Share, X } from "lucide-react";
import { promptInstall, useInstallState } from "@/lib/install";

const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

/** 헤더의 '앱 설치' 버튼 + 설치 안내 바텀 시트. 설치된 앱(standalone)에서는 아무것도 그리지 않는다. */
export default function InstallApp() {
  const { installed } = useInstallState();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (installed) return null;

  const onClick = async () => {
    // 저장된 설치 이벤트가 있으면 안드로이드 기본 설치 다이얼로그, 없으면(아이폰·재설치 대기) 안내 시트
    if (!(await promptInstall())) setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="theme-t inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-primary bg-surface px-3.5 text-label font-bold text-primary active:opacity-80"
      >
        <Download size={16} aria-hidden />앱 설치
      </button>
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
