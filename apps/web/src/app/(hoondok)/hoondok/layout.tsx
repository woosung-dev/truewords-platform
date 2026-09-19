// 훈독 루트 레이아웃 — /hoondok/* 전체. 시연 챗 AuthGuard 를 쓰지 않는다 (비로그인 읽기, PLAN-HD-001 §4).
// 폰트·React Query Provider 는 루트 layout 을 공유하고, 토큰·컴포넌트 CSS 만 [data-app="hoondok"] 로 격리한다.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import "@/app/hoondok.css";
import { HoondokAppShell } from "@/components/hoondok";
import { isHoondokEnabled } from "@/features/hoondok/flag";

// 베타 기간 검색 색인 금지 (권리 미확정 정본). next.config headers() 의 X-Robots-Tag 와 짝이다.
export const metadata: Metadata = {
  title: "훈독",
  description: "아침 3분 훈독 — 독립 운영 베타",
  robots: { index: false, follow: false },
};

// 오늘 날짜(KST)를 요청마다 계산하므로 정적 프리렌더를 끈다.
export const dynamic = "force-dynamic";

export default function HoondokLayout({ children }: { children: ReactNode }) {
  if (!isHoondokEnabled()) notFound();
  return (
    <div data-app="hoondok">
      <HoondokAppShell>{children}</HoondokAppShell>
    </div>
  );
}
