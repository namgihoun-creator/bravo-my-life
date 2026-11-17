"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeToast } from "@/lib/toast";

const DURATION_MS = 3500;

export default function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = subscribeToast((m) => {
      setMessage(m);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMessage(null), DURATION_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer.current);
    };
  }, []);

  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-[60] mx-auto w-fit max-w-[90%] rounded-2xl bg-ink px-4 py-2.5 text-center text-label font-semibold text-bg shadow-sticky"
    >
      {message}
    </div>
  );
}
