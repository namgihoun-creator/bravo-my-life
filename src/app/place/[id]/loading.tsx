import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ModeAttr from "@/components/ModeAttr";

/**
 * 상세 페이지 첫 진입(서버 렌더 대기) 때 즉시 보이는 스켈레톤. 실제 페이지와 같은 폭·여백이라 전환 때 레이아웃이 튀지 않는다.
 * 홈으로 돌아가는 링크는 로딩 중에도 쓸 수 있게 둔다.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-md md:max-w-2xl">
      <main className="px-4 pb-4 pt-3" aria-busy="true" aria-label="가게 정보를 불러오는 중">
        <ModeAttr mode="nopo" />
        <Link href="/" className="inline-flex min-h-[44px] items-center gap-1 text-label font-semibold text-primary">
          <ArrowLeft size={16} aria-hidden />
          내 주변 노포 지도로
        </Link>
        <div className="theme-t mt-1 animate-pulse rounded-2xl border border-line bg-surface p-4 shadow-card" aria-hidden>
          <div className="flex items-start justify-between gap-2">
            <div className="h-7 w-2/3 rounded-lg bg-tag-bg" />
            <div className="h-7 w-20 rounded-full bg-tag-bg" />
          </div>
          <div className="mt-3 h-4 w-1/2 rounded bg-tag-bg" />
          <div className="mt-2 h-4 w-4/5 rounded bg-tag-bg" />
          <div className="mt-4 h-4 w-full rounded bg-tag-bg" />
          <div className="mt-2 h-4 w-3/4 rounded bg-tag-bg" />
          <div className="mt-4 flex gap-2">
            <div className="h-11 flex-1 rounded-xl bg-tag-bg" />
            <div className="h-11 flex-1 rounded-xl bg-tag-bg" />
          </div>
          <div className="mt-3 flex gap-2">
            <div className="h-12 flex-1 rounded-xl bg-tag-bg" />
            <div className="h-12 w-11 rounded-xl bg-tag-bg" />
            <div className="h-12 w-11 rounded-xl bg-tag-bg" />
          </div>
        </div>
      </main>
    </div>
  );
}
