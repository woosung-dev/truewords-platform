// SCR-PWA-007 말씀 서고 (PLAN-HD-002 W3-L). 프리뷰 플래그 뒤에만 존재한다 — OFF 면 404 다.
import { notFound } from "next/navigation";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { LibraryScreen } from "@/features/hoondok/library/components/library-screen";

export default function HoondokLibraryPage() {
  if (!isHoondokPreviewEnabled()) notFound();
  return <LibraryScreen />;
}
