import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "@/components/providers";

// 시연 챗 본문 글꼴은 Pretendard 가변 서브셋(KS X 1001 한글 2,350자 + 라틴·기호)을 이 앱 안에서 자체 호스팅한다.
// Inter 에는 한글이 없어 한국어가 OS 글꼴로 바뀌었다. 서브셋에 없는 글자는 시스템 sans-serif 로 넘어간다.
// 루트 layout 은 훈독(/hoondok, 자체 Pretendard 패밀리)도 감싸므로 preload 하지 않는다 — 글자를 그릴 때만 받는다.
// 디스플레이·본문 세리프는 쓰는 화면에서만 싣는다(truewords-fonts.ts·truewords-reading-fonts.ts).
const pretendard = localFont({
  src: "./_fonts/PretendardVariable-1.3.9.subset.woff2",
  weight: "45 920",
  display: "swap",
  preload: false,
  variable: "--font-pretendard",
});

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
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
