import Link from "next/link";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

/**
 * 공통 푸터 (Home·상세·법적 고지 페이지).
 * 모바일 3행: ① 브랜드+설명 ② 개인정보 처리방침·이용약관(각 44px) ③ Created by·©·버전
 * 768px 이상: 좌(브랜드) / 우(링크 + 메타) 2열. 훅이 없어 서버·클라이언트 양쪽에서 쓸 수 있다.
 */
export default function Footer() {
  return (
    <footer className="mt-8 border-t border-line px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 md:flex md:items-start md:justify-between md:gap-6">
      <div className="min-w-0">
        <p className="text-label font-bold text-ink">
          MyLife Hub <span className="font-medium text-muted">×</span> Bravo My Life
        </p>
        <p className="mt-0.5 text-caption text-muted">내 손안의 동네 생존 &amp; 찐노포 가이드</p>
      </div>
      <div className="mt-1 min-w-0 md:mt-0 md:text-right">
        <nav aria-label="법적 고지" className="flex flex-wrap items-center md:justify-end">
          <Link href="/privacy" className="inline-flex min-h-[44px] items-center pr-4 text-caption font-semibold text-ink active:opacity-70">
            개인정보 처리방침
          </Link>
          <Link href="/terms" className="inline-flex min-h-[44px] items-center pr-4 text-caption font-semibold text-ink active:opacity-70 md:pr-0">
            이용약관
          </Link>
        </nav>
        {/* 좁은 화면에서 'v0.1.0' 이 혼자 꺾이지 않게 항목 단위로만 줄바꿈한다 */}
        <p className="tnum text-caption text-muted">
          <span className="inline-block">Created by NamGiHoun</span> · <span className="inline-block">© 2026 MyLife Hub</span> ·{" "}
          <span className="inline-block">v{VERSION}</span>
        </p>
      </div>
    </footer>
  );
}
