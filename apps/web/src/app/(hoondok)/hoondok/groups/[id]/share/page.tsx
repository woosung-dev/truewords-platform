// /hoondok/groups/{id}/share — SCR-PWA-020 한 줄 나눔 쓰기 (PLAN-HD-010 W1). 킬 스위치 OFF 면 404(D3).
import { notFound } from "next/navigation";
import { isHoondokTogetherEnabled } from "@/features/hoondok/flag";
import { GroupShareForm } from "@/features/hoondok/together/components/group-share-form";

export default async function HoondokGroupSharePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isHoondokTogetherEnabled()) notFound();
  const { id } = await params;
  return <GroupShareForm groupId={id} />;
}
