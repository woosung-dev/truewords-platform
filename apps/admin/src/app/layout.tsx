import type { Metadata } from "next";
// 폰트는 Fontsource 로 자체 호스팅한다 — Next 의 Google 폰트 로더는 빌드·dev 중 Google Fonts 를 받아
// Turbopack 버그(vercel/next.js#99114)로 무작위 실패한다. CSS 변수는 globals.css :root 에서 정의.
import "@fontsource-variable/inter";
import "./globals.css";
import Providers from "@/components/providers";

export const metadata: Metadata = {
  title: "TrueWords Admin",
  description: "말씀 AI 챗봇 관리자 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-[family-name:var(--font-inter),sans-serif]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
