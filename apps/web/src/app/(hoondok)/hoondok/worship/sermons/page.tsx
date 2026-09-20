// /hoondok/worship/sermons — SCR-PWA-012 5분 설교·전체 설교 (PLAN-HD-002 W3-W).
import { notFound } from "next/navigation";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { SermonsScreen } from "@/features/hoondok/worship/components/sermons-screen";

export default function HoondokSermonsPage() {
  if (!isHoondokPreviewEnabled()) notFound();
  return <SermonsScreen />;
}
