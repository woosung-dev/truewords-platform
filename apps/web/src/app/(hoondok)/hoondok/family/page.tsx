// /hoondok/family — SCR-PWA-016 가족·친구 (PLAN-HD-002 W3-F). 앱바(제목 "가족·친구"·뒤로 /hoondok/garden)는
// screens.ts 가, 훈독 플래그 게이트는 layout 이 담당한다. 이 화면은 프리뷰 셸이라 프리뷰 플래그가 꺼지면 404 다 —
// 운영 이미지는 NEXT_PUBLIC_HOONDOK_PREVIEW 를 넘기지 않는다.
import { notFound } from "next/navigation";
import { FamilyScreen } from "@/features/hoondok/family/components/family-screen";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";

export default function HoondokFamilyPage() {
  if (!isHoondokPreviewEnabled()) notFound();
  return <FamilyScreen />;
}
