// /hoondok/groups/{id}/settings — SCR-PWA-021 모임 설정 (PLAN-HD-010 W1). 킬 스위치 OFF 면 404(D3).
// 리더/모임원 분기는 서버 상세의 me.role 로 클라이언트가 정한다 — 권한 판정 자체는 서버(403)다.
import { notFound } from "next/navigation";
import { isHoondokTogetherEnabled } from "@/features/hoondok/flag";
import { GroupSettings } from "@/features/hoondok/together/components/group-settings";

export default async function HoondokGroupSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isHoondokTogetherEnabled()) notFound();
  const { id } = await params;
  return <GroupSettings groupId={id} />;
}
