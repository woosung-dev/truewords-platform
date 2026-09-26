import type { Metadata } from "next";
// 폰트는 Fontsource 로 자체 호스팅한다 — Next 의 Google 폰트 로더는 빌드·dev 중 Google Fonts 를 받아
// Turbopack 버그(vercel/next.js#99114)로 무작위 실패한다. CSS 변수는 globals.css :root 에서 정의.
import "@fontsource-variable/inter";
// 묵상/본문 페이지 — 가독성 높은 한국어 세리프
import "@fontsource/noto-serif-kr/400.css";
import "@fontsource/noto-serif-kr/500.css";
import "@fontsource/noto-serif-kr/700.css";
// 디스플레이 헤딩 — 학술적 권위
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "./globals.css";
import Providers from "@/components/providers";

export const metadata: Metadata = {
  title: "TrueWords",
  description: "말씀 데이터 기반 AI 챗봇",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
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
      </body>
    </html>
  );
}
