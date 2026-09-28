// /hoondok/worship — 가정예배 탭 첫 화면 = SCR-PWA-012 5분 설교 (PLAN-HD-002 W3-W · 2026-09-29 전체 메뉴 개편).
// 이번 주 순서지·챌린지는 /hoondok/worship/order 로 옮겼다 — 전체 메뉴 > 가정예배에서 연다.
// 프리뷰 플래그 OFF 면 404 다. `NEXT_PUBLIC_*` 은 빌드 시 인라인되므로 운영 이미지에서는 언제나 꺼져 있다.
import { notFound } from "next/navigation";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { SermonsScreen } from "@/features/hoondok/worship/components/sermons-screen";

export default function HoondokWorshipPage() {
  if (!isHoondokPreviewEnabled()) notFound();
  return <SermonsScreen />;
}
