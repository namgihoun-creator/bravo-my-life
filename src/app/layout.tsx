import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import ToastHost from "@/components/ToastHost";

export const metadata: Metadata = {
  title: "브라보 마이 라이프",
  description: "내 손안의 동네 생존 & 찐노포 가이드",
  applicationName: "브라보 마이 라이프",
  manifest: "/manifest.json",
  // iOS '홈 화면에 추가' 시 주소창 없이 전체 화면으로 열림
  appleWebApp: {
    capable: true,
    title: "브라보 마이 라이프",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
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
    <html lang="ko" data-mode="survival" className="h-full">
      <head>
        {/* beforeinstallprompt 는 hydrate 전에 올 수 있어 먼저 잡아 둔다(앱 설치 버튼이 window.__bip 를 사용) */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bip=e;});",
          }}
        />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full">
        {children}
        <ServiceWorkerRegister />
        <ToastHost />
      </body>
    </html>
  );
}
