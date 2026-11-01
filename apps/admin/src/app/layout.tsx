import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "@/components/providers";

// 본문 글꼴은 Pretendard 가변 서브셋(KS X 1001 한글 2,350자 + 라틴·기호)을 이 앱 안에서 자체 호스팅한다.
// Inter 에는 한글이 없어 한국어가 OS 글꼴로 바뀌었다. 서브셋에 없는 글자는 시스템 sans-serif 로 넘어간다.
// 사용자 웹과 파일을 공유하지 않는다(앱별 소유). globals.css 의 --font-sans 가 이 변수를 쓴다.
const pretendard = localFont({
  src: "./_fonts/PretendardVariable-1.3.9.subset.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
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
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
