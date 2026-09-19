// 훈독 루트 레이아웃 — /hoondok/* 전체. 시연 챗 AuthGuard 를 쓰지 않는다 (비로그인 읽기, PLAN-HD-001 §4).
// React Query Provider 는 루트 layout 을 공유한다. 토큰·컴포넌트 CSS 와 Pretendard self-host(@font-face) 는
// [data-app="hoondok"] 스코프·/hoondok/fonts 로 격리하고, PWA manifest·아이콘·theme-color(Phase 3 C)와 서비스워커 등록(Phase 3 D)도
// 이 레이아웃에만 붙인다.
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import "@/app/hoondok.css";
import { HoondokAppShell } from "@/components/hoondok";
import { isHoondokEnabled } from "@/features/hoondok/flag";
import {
  HOONDOK_APPLE_TOUCH_ICON,
  HOONDOK_ICON_192,
  HOONDOK_MANIFEST_PATH,
  HOONDOK_THEME_COLOR,
} from "@/features/hoondok/pwa";
import { HoondokServiceWorker } from "@/features/hoondok/service-worker";

// 베타 기간 검색 색인 금지 (권리 미확정 정본). next.config headers() 의 X-Robots-Tag 와 짝이다.
const BASE_METADATA: Metadata = {
  title: "훈독",
  description: "아침 3분 훈독 — 독립 운영 베타",
  robots: { index: false, follow: false },
};

// 플래그 OFF 면 404 응답에 manifest·아이콘 링크가 새지 않도록 설치 메타를 붙이지 않는다.
export function generateMetadata(): Metadata {
  if (!isHoondokEnabled()) return BASE_METADATA;
  return {
    ...BASE_METADATA,
    manifest: HOONDOK_MANIFEST_PATH,
    appleWebApp: { capable: true, title: "훈독", statusBarStyle: "default" },
    icons: {
      icon: [{ url: HOONDOK_ICON_192, sizes: "192x192", type: "image/png" }],
      apple: [{ url: HOONDOK_APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png" }],
    },
  };
}

export function generateViewport(): Viewport {
  return isHoondokEnabled() ? { themeColor: HOONDOK_THEME_COLOR } : {};
}

// 오늘 날짜(KST)를 요청마다 계산하므로 정적 프리렌더를 끈다.
export const dynamic = "force-dynamic";

export default function HoondokLayout({ children }: { children: ReactNode }) {
  if (!isHoondokEnabled()) notFound();
  return (
    <div data-app="hoondok">
      <HoondokAppShell>{children}</HoondokAppShell>
      <HoondokServiceWorker />
    </div>
  );
}
