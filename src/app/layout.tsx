import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import SplashScreen from "@/components/SplashScreen";
import ToastHost from "@/components/ToastHost";
import { SITE_URL } from "@/lib/site";

const OG_TITLE = "Bravo My Life — 내 주변 찐노포 & 생활 편의 탐색";
const OG_DESC =
  "30년 넘은 찐노포 맛집부터 급할 때 찾는 개방화장실·공영주차장·세탁방까지, 내 주변 알짜 장소를 한눈에 찾고 길찾기까지 한 번에.";

// iOS 홈 화면 실행 시작 화면: 기기 CSS 해상도·배율별 이미지(scripts/make_icons.py 가 public/splash 에 생성)
const IOS_SPLASH: [number, number, number][] = [
  [375, 667, 2],
  [375, 812, 3],
  [414, 736, 3],
  [414, 896, 2],
  [414, 896, 3],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [428, 926, 3],
  [430, 932, 3],
  [440, 956, 3],
];
const startupImage = IOS_SPLASH.map(([w, h, r]) => ({
  url: `/splash/apple-splash-${w * r}x${h * r}.png`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
}));

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: OG_TITLE,
  description: OG_DESC,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "Bravo My Life",
    url: SITE_URL,
    title: OG_TITLE,
    description: OG_DESC,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: OG_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESC,
    images: ["/og-image.png"],
  },
  applicationName: "브라보 마이 라이프",
  manifest: "/manifest.json",
  // iOS '홈 화면에 추가' 시 주소창 없이 전체 화면으로 열림
  appleWebApp: {
    capable: true,
    title: "브라보 마이 라이프",
    statusBarStyle: "default",
    startupImage,
  },
  formatDetection: { telephone: false },
  // 검색엔진 소유권 인증(공개 토큰). 구글 서치콘솔·네이버 서치어드바이저
  verification: {
    google: "Ob59aWoNWRKbybtWVc12U6DkpuD78OzUEg7XvOm4rSE",
    other: { "naver-site-verification": "51ff567e74cbb67f2b8f6a0075d4c3de080c0f68" },
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icons/icon-192.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b5fff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-mode="survival" className="h-full" suppressHydrationWarning>
      <head>
        {/* beforeinstallprompt 는 hydrate 전에 올 수 있어 먼저 잡아 둔다(앱 설치 버튼이 window.__bip 를 사용) */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bip=e;});",
          }}
        />
        {/* 스플래시: 홈(/) 첫 진입(세션당 1회)에서만 첫 페인트 전에 켠다. 저장소 접근 실패 시 띄우지 않는다 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(location.pathname==='/'&&!sessionStorage.getItem('bml_splash_shown')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){sessionStorage.setItem('bml_splash_shown','1');document.documentElement.setAttribute('data-splash','1');}}catch(e){}",
          }}
        />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full">
        <SplashScreen />
        {children}
        <ServiceWorkerRegister />
        <ToastHost />
      </body>
    </html>
  );
}
