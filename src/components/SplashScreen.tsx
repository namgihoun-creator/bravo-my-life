"use client";

import { useEffect, useRef } from "react";

/** 표시 700ms = 정지 450ms + 페이드아웃 250ms. 긴급 상황 사용자를 오래 막지 않는다. */
const HOLD_MS = 450;
const FADE_MS = 250;

/**
 * 앱 첫 진입 브랜드 스플래시. 노출 여부는 layout `<head>` 인라인 스크립트가 첫 페인트 전에 정한다
 * (`/` 진입 + 이 세션에서 아직 안 봤을 때만 `html[data-splash]` 설정 → 새로고침·뒤로가기에는 미노출).
 * 마크업은 항상 렌더하고 CSS가 `data-splash` 일 때만 보여 줘서 하이드레이션 불일치와 깜빡임이 없다.
 * 포인터를 막지 않으며(pointer-events: none) 스크린리더에는 숨긴다. `prefers-reduced-motion` 이면 CSS가 처음부터 숨긴다.
 */
export default function SplashScreen() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!root.hasAttribute("data-splash") || !el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.removeAttribute("data-splash");
      return;
    }
    const fade = window.setTimeout(() => el.classList.add("splash-out"), HOLD_MS);
    const done = window.setTimeout(() => {
      root.removeAttribute("data-splash");
      el.classList.remove("splash-out");
    }, HOLD_MS + FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, []);

  return (
    <div ref={ref} className="splash" aria-hidden>
      <div className="splash-logo">B</div>
      <p className="splash-title">Bravo My Life</p>
      <p className="splash-sub">내 손안의 동네 생존 &amp; 찐노포 가이드</p>
    </div>
  );
}
