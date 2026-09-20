// /hoondok/worship/request — SCR-PWA-013 설교 섭외·신청 폼 (PLAN-HD-002 W3-W).
// DEC-PWA-021 미결이라 받는 곳이 없다. 폼은 마크업만 살아 있고 제출은 인라인 "준비 중"에서 멈춘다.
import { notFound } from "next/navigation";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { SermonRequestForm } from "@/features/hoondok/worship/components/sermon-request-form";

export default function HoondokSermonRequestPage() {
  if (!isHoondokPreviewEnabled()) notFound();
  return <SermonRequestForm />;
}
