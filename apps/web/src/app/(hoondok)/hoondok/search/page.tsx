// SCR-PWA-008 말씀 검색 (PLAN-HD-002 W3-L). 프리뷰 플래그 뒤에만 존재한다 — OFF 면 404 다.
import { notFound } from "next/navigation";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { SearchScreen } from "@/features/hoondok/library/components/search-screen";

export default function HoondokSearchPage() {
  if (!isHoondokPreviewEnabled()) notFound();
  return <SearchScreen />;
}
