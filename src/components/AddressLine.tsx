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

/** 노포 카드 주소 줄: 복사 아이콘이 주소 마지막 글자 바로 뒤에 붙어 한 덩어리로 읽힌다(줄바꿈돼도 마지막 줄 끝). 탭하면 복사되고 아이콘이 체크로 바뀐다(1.6초). 주소는 전부 보여 준다(최대 27자라 2줄 이내). */
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
      <MapPin size={14} strokeWidth={2} className="mt-[2px] shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 leading-[1.4] [overflow-wrap:anywhere]">
        {address}
        {copied ? (
          <Check size={14} strokeWidth={2.5} className="ml-1 inline-block align-[-2px] text-success" aria-hidden />
        ) : (
          <Copy size={14} strokeWidth={2} className="ml-1 inline-block align-[-2px]" aria-hidden />
        )}
      </span>
      <span role="status" className="sr-only">
        {copied ? "주소가 복사됐어요" : ""}
      </span>
    </button>
  );
}
