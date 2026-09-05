import type { Metadata } from "next";
import { Inter, Noto_Serif_KR, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import Providers from "@/components/providers";

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
  title: "TrueWords Admin",
  description: "말씀 AI 챗봇 관리자 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${inter.variable} ${notoSerifKR.variable} ${cormorant.variable} h-full antialiased`}
    >
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
