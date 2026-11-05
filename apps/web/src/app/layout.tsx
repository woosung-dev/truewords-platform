import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "@/components/providers";

// 훈독 스코프([data-app="hoondok"]) 밖(404·토스트 등)의 본문 글꼴 — Pretendard 가변 서브셋(KS X 1001 한글 2,350자 + 라틴·기호)을
// 이 앱 안에서 자체 호스팅한다. 서브셋에 없는 글자는 시스템 sans-serif 로 넘어간다.
// 훈독 화면은 자체 Pretendard 패밀리를 쓰므로 preload 하지 않는다 — 글자를 그릴 때만 받는다.
// 웹 루트는 훈독이다(DEC-PWA-026). 훈독 메타·PWA 설치 정보는 (hoondok)/layout.tsx 가 붙인다.
const pretendard = localFont({
  src: "./_fonts/PretendardVariable-1.3.9.subset.woff2",
  weight: "45 920",
  display: "swap",
  preload: false,
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "훈독",
  description: "아침 3분 훈독 · 독립 운영 베타",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
