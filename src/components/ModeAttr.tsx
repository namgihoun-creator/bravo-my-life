"use client";

import { useEffect } from "react";

/** 상세 페이지처럼 Home 밖의 화면에서 모드 테마(`html[data-mode]`)를 맞춘다. */
export default function ModeAttr({ mode }: { mode: "survival" | "nopo" }) {
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);
  return null;
}
