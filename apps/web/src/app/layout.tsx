import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter, Noto_Serif_KR } from "next/font/google";
import "./globals.css";
import Providers from "@/components/providers";
import PwaRegister from "@/components/pwa/pwa-register";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// 묵상/본문 페이지 — 가독성 높은 한국어 세리프
const notoSerifKR = Noto_Serif_KR({
  variable: "--font-reading",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

// 디스플레이 헤딩 — 학술적 권위
const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrueWords",
  description: "말씀 데이터 기반 AI 챗봇",
  // 훈독 PWA 셸 (플래그 게이트). manifest 는 src/app/manifest.ts, 서비스워커는 public/sw.js.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "훈독", statusBarStyle: "default" },
  icons: { apple: "/icons/hoondok-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#2E2A5A",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${inter.variable} ${notoSerifKR.variable} ${cormorant.variable} h-full antialiased`}>
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col font-[Pretendard,var(--font-inter),sans-serif]">
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
