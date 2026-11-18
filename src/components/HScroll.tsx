"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const DRAG_THRESHOLD = 5; // px — 이 이상 끌었으면 '드래그'로 보고 뗄 때 클릭을 막는다
const FADE = 28; // px — 이어지는 칩이 있다는 가장자리 그라데이션

/**
 * 가로 스크롤 칩 컨테이너 (PC 마우스 지원).
 *  - 마우스 휠(세로) → 좌우 스크롤. 가로 오버플로우가 있고 아직 더 갈 수 있을 때만 가로채서, 끝에서는 페이지 세로 스크롤을 방해하지 않는다.
 *  - 마우스 왼쪽 버튼 드래그 → 좌우 스크롤(터치 스와이프처럼). 5px 이상 끌고 뗄 때 칩 onClick 은 막는다.
 *  - 마우스 환경(`hover: hover` + `pointer: fine`)에서만, 더 스크롤할 칩이 남은 쪽에 `<` `>` 원형 버튼을 띄운다(터치 기기에서는 숨김).
 *  - 남은 칩이 있는 쪽 가장자리는 부드럽게 페이드한다.
 * 터치 스와이프는 브라우저 기본 동작 그대로 둔다.
 */
export default function HScroll({
  children,
  scrollRef,
  ariaLabel,
  className = "",
}: {
  children: ReactNode;
  /** 스크롤 요소 ref (활성 칩 자동 스크롤 등에 쓴다). 없으면 내부 ref 를 쓴다. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  ariaLabel?: string;
  /** 바깥 래퍼에 붙는 클래스 */
  className?: string;
}) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const elRef = scrollRef ?? ownRef;
  const [edge, setEdge] = useState({ left: false, right: false });
  const edgeRef = useRef({ left: false, right: false });
  const drag = useRef({ down: false, moved: false, startX: 0, startLeft: 0, id: -1 });

  // 칩이 늘고 줄거나(필터 변경) 화면 폭이 바뀌면 양끝에 더 갈 칩이 있는지 다시 잰다
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 2;
      const cur = edgeRef.current;
      if (cur.left === left && cur.right === right) return; // 값이 같으면 상태를 건드리지 않는다(재렌더→옵저버 재등록→재측정 무한 루프 방지)
      edgeRef.current = { left, right };
      setEdge({ left, right });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child); // 칩 폭이 바뀌어도(개수 표시 등) 다시 잰다
    window.addEventListener("resize", measure);

    // 마우스 휠(세로) → 가로 스크롤. preventDefault 를 쓰려면 passive:false 네이티브 리스너여야 한다.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // 트랙패드 가로 스와이프는 기본 동작
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const max = el.scrollWidth - el.clientWidth;
      const canMove = (dy > 0 && el.scrollLeft < max - 1) || (dy < 0 && el.scrollLeft > 1);
      if (!canMove) return; // 끝이면 페이지 세로 스크롤에 맡긴다
      e.preventDefault();
      el.scrollLeft += dy;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = elRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    drag.current = { down: true, moved: false, startX: e.clientX, startLeft: el.scrollLeft, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = elRef.current;
    if (!d.down || !el || e.pointerId !== d.id) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      el.dataset.dragging = "1";
      el.setPointerCapture(e.pointerId); // 칩 밖으로 나가도 계속 끌린다
    }
    el.scrollLeft = d.startLeft - dx;
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = elRef.current;
    if (!d.down) return;
    d.down = false;
    if (el) {
      delete el.dataset.dragging;
      if (d.moved && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    }
    // 드래그였다면 곧바로 오는 click 은 칩에 닿지 않게 막는다(다음 tick 에 해제)
    if (d.moved) window.setTimeout(() => (d.moved = false), 0);
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const nudge = (dir: -1 | 1) => {
    const el = elRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  // 더 갈 칩이 있는 쪽만 페이드. 마우스 환경에서는 화살표가 놓일 자리(--hs-gutter)까지 칩이 먼저 사라져 글자와 겹치지 않는다.
  const mask =
    edge.left || edge.right
      ? `linear-gradient(to right, ${
          edge.left ? `transparent 0, transparent var(--hs-gutter), #000 calc(var(--hs-gutter) + ${FADE}px)` : "#000 0"
        }, ${
          edge.right
            ? `#000 calc(100% - var(--hs-gutter) - ${FADE}px), transparent calc(100% - var(--hs-gutter)), transparent 100%`
            : "#000 100%"
        })`
      : undefined;

  return (
    <div className={`relative min-w-0 flex-1 ${className}`}>
      <div
        ref={elRef}
        role="group"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        style={{ WebkitMaskImage: mask, maskImage: mask }}
        className="hscroll no-scrollbar flex gap-2 overflow-x-auto"
      >
        {children}
      </div>
      {edge.left && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="이전 칩 보기"
          onClick={() => nudge(-1)}
          className="hscroll-arrow hscroll-arrow-left theme-t items-center justify-center rounded-full border border-line bg-surface text-ink shadow-card"
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        </button>
      )}
      {edge.right && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="다음 칩 보기"
          onClick={() => nudge(1)}
          className="hscroll-arrow hscroll-arrow-right theme-t items-center justify-center rounded-full border border-line bg-surface text-ink shadow-card"
        >
          <ChevronRight size={16} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
}
