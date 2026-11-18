"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MapPin } from "lucide-react";

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

/** 노포 카드 주소 줄: 탭하면 주소가 복사되고 '복사됨'이 잠깐 보인다. 긴 주소는 2줄까지. */
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
      className="-my-2 mt-0.5 flex min-h-[44px] w-full min-w-0 items-center gap-1.5 text-left text-label text-muted"
    >
      <MapPin size={14} strokeWidth={2} className="shrink-0" aria-hidden />
      <span className="line-clamp-2 min-w-0 flex-1 leading-[1.4] [overflow-wrap:anywhere]">{address}</span>
      {copied && (
        <span
          role="status"
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-tag-bg px-2 py-0.5 text-caption font-bold text-tag-text"
        >
          <Check size={12} strokeWidth={2.5} aria-hidden />
          복사됨
        </span>
      )}
    </button>
  );
}
