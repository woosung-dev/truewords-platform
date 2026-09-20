// /hoondok/worship — SCR-PWA-010 가정예배 홈 (PLAN-HD-002 W3-W).
// 프리뷰 플래그 OFF 면 404 다. `NEXT_PUBLIC_*` 은 빌드 시 인라인되므로 운영 이미지에서는 언제나 꺼져 있다.
import { notFound } from "next/navigation";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { WorshipHome } from "@/features/hoondok/worship/components/worship-home";

export default function HoondokWorshipPage() {
  if (!isHoondokPreviewEnabled()) notFound();
  return <WorshipHome />;
}
