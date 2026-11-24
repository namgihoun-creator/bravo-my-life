import Link from "next/link";
import FeedbackButton from "@/components/FeedbackSheet";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

const linkCls =
  "-my-3.5 inline-flex items-center py-3.5 text-caption font-semibold text-ink whitespace-nowrap active:opacity-70"; // 글자 16px + 위아래 14px = 터치 44px, 음수 마진으로 줄 높이는 그대로

const Dot = () => (
  <span aria-hidden className="hidden text-muted md:inline">
    ·
  </span>
);

/**
 * 공통 푸터 (Home·상세·법적 고지 페이지). 본문 컨테이너(max-w-md/2xl) 밖에 두어 자체 폭(max-w-5xl)을 가진다.
 * - 768px 이상: 좌(브랜드+설명) / 우(Created by · 링크 · ©·버전)가 한 줄(flex-row justify-between items-center)
 * - 모바일: 좌 블록 / 우 블록이 위아래로 쌓이고 각 블록은 항목 단위로만 줄바꿈(가로 넘침 없음)
 * 훅이 없어 서버·클라이언트 양쪽에서 쓸 수 있다.
 */
export default function Footer() {
  return (
    <footer className="mx-auto mt-8 w-full max-w-5xl border-t border-line px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 md:flex md:flex-row md:items-center md:justify-between md:gap-3">
      <p className="text-caption text-muted md:whitespace-nowrap">
        <span className="text-label font-bold text-ink">Bravo My Life</span>{" "}
        <span className="inline-block">내 손안의 동네 생존 &amp; 찐노포 가이드</span>
      </p>
      <div className="tnum mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted md:mt-0 md:flex-nowrap md:justify-end md:gap-x-1.5 md:whitespace-nowrap">
        <span className="whitespace-nowrap">Created by NamGiHoun</span>
        <Dot />
        <FeedbackButton className={`${linkCls} cursor-pointer`} />
        <Dot />
        <Link href="/privacy" className={linkCls}>
          개인정보 처리방침
        </Link>
        <Dot />
        <Link href="/terms" className={linkCls}>
          이용약관
        </Link>
        <Dot />
        <span className="whitespace-nowrap">© 2026 Bravo My Life</span>
        <Dot />
        <span className="whitespace-nowrap">v{VERSION}</span>
      </div>
    </footer>
  );
}
