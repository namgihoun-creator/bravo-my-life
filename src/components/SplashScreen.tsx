"use client";

import { useEffect, useRef } from "react";

/** 표시 2,000ms = 정지 1,700ms + 페이드아웃 300ms. 긴급 상황 사용자를 오래 막지 않는다. */
const HOLD_MS = 1700;
const FADE_MS = 300;

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
      <div className="splash-inner">
        <div className="splash-brand">
          <div className="splash-logo">B</div>
          <span className="splash-label">BRAVO MY LIFE</span>
        </div>
        <h1 className="splash-head">
          지금 필요한 <em>생존</em>부터
          <br />
          세월이 증명한 <em>찐노포</em>까지.
        </h1>
        <p className="splash-desc">광고 없이 발품과 데이터로 검증한 내 주변 진짜 동네 지도</p>
        <div className="splash-caps">
          <span className="splash-cap">24시 긴급 생존 인프라</span>
          <span className="splash-cap">업력 10년+ 검증 노포</span>
        </div>
      </div>
      <div className="splash-foot">
        <div className="splash-track">
          <div className="splash-bar" />
        </div>
        <p className="splash-sub">내 손안의 동네 생존 &amp; 찐노포 가이드</p>
      </div>
    </div>
  );
}
