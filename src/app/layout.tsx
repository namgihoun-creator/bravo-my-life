import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import ToastHost from "@/components/ToastHost";

export const metadata: Metadata = {
  title: "Bravo My Life",
  description: "내 손안의 동네 생존 & 찐노포 가이드",
  applicationName: "브라보 마이 라이프",
  manifest: "/manifest.json",
  // iOS '홈 화면에 추가' 시 주소창 없이 전체 화면으로 열림
  appleWebApp: {
    capable: true,
    title: "브라보",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
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
