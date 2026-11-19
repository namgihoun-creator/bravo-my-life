import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Footer from "@/components/Footer";

/** /privacy·/terms 공통 틀: 읽기 전용 정적 페이지(모달이 아니라 URL을 가진다 — 검색·공유·뒤로가기가 그대로 동작) */
export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
    <div className="mx-auto w-full max-w-md md:max-w-2xl">
      <main className="px-4 pb-4 pt-3">
        <Link href="/" className="inline-flex min-h-[44px] items-center gap-1 text-label font-semibold text-primary">
          <ArrowLeft size={16} aria-hidden />
          지도로 돌아가기
        </Link>
        <h1 className="mt-1 text-title2 font-bold tracking-[-0.02em] text-ink">{title}</h1>
        <p className="tnum mt-1 text-caption text-muted">시행·최종 수정일 {updated}</p>
        <div className="mt-4 space-y-5 text-label leading-relaxed text-ink [&_h2]:mb-1.5 [&_h2]:text-body [&_h2]:font-bold [&_li]:ml-4 [&_li]:list-disc [&_li]:py-0.5 [&_p]:text-muted [&_ul]:text-muted">
          {children}
        </div>
      </main>
    </div>
      <Footer />
    </>
  );
}
