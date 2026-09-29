// /hoondok/worship/order — SCR-PWA-010 이번 주 순서지·챌린지 (PLAN-HD-002 W3-W).
// 2026-09-29 넷째 탭을 "5분 설교"로 바꾸면서 이 화면으로 옮겼다. 프리뷰 플래그 OFF 면 404 다.
import { notFound } from "next/navigation";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { WorshipOrder } from "@/features/hoondok/worship/components/worship-order";

export default function HoondokWorshipOrderPage() {
  if (!isHoondokPreviewEnabled()) notFound();
  return <WorshipOrder />;
}
