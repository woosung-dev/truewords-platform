// /hoondok/groups/{id} — SCR-PWA-017 훈독 모임 상세 (PLAN-HD-010 W1). 킬 스위치 OFF 면 404(D3).
// 비모임원·없는 모임도 서버가 404 를 주고, 화면은 "이 모임을 볼 수 없어요" 로 안내한다.
import { notFound } from "next/navigation";
import { isHoondokTogetherEnabled } from "@/features/hoondok/flag";
import { GroupDetailView } from "@/features/hoondok/together/components/group-detail";

export default async function HoondokGroupPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isHoondokTogetherEnabled()) notFound();
  const { id } = await params;
  return <GroupDetailView groupId={id} />;
}
