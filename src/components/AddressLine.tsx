"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, MapPin } from "lucide-react";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 노포 카드 주소 줄: 우측 복사 아이콘이 탭하면 주소를 복사하고 체크로 바뀐다(1.6초). 긴 주소는 2줄까지, 아이콘은 첫 줄에 맞춘다. */
export default function AddressLine({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    if (!(await copyText(address))) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`주소 복사: ${address}`}
      className="-my-2 mt-0.5 flex min-h-[44px] w-full min-w-0 items-start gap-1.5 py-[13px] text-left text-label text-muted"
    >
      {/* 아이콘은 첫 줄(line-height 1.4 ≈ 18px) 가운데에 맞춘다 */}
      <MapPin size={14} strokeWidth={2} className="mt-[2px] shrink-0" aria-hidden />
      <span className="line-clamp-2 min-w-0 flex-1 leading-[1.4] [overflow-wrap:anywhere]">{address}</span>
      {copied ? (
        <Check size={14} strokeWidth={2.5} className="mt-[2px] shrink-0 text-success" aria-hidden />
      ) : (
        <Copy size={14} strokeWidth={2} className="mt-[2px] shrink-0" aria-hidden />
      )}
      <span role="status" className="sr-only">
        {copied ? "주소가 복사됐어요" : ""}
      </span>
    </button>
  );
}
