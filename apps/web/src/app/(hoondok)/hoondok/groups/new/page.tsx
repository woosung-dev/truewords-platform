// /hoondok/groups/new — SCR-PWA-019 모임 만들기 (PLAN-HD-010 W1). 킬 스위치 OFF 면 404(D3).
// 앱바 제목·뒤로·탭은 screens.ts 가, 로그인 확인은 클라이언트 화면이 한다(쿠키는 HttpOnly).
// KST 오늘은 서버에서 한 번만 계산해 정성 시작일 기본값으로 넘긴다(자정 경계 hydration 어긋남 방지).
import { notFound } from "next/navigation";
import { isHoondokTogetherEnabled } from "@/features/hoondok/flag";
import { formatKstDate } from "@/features/hoondok/today";
import { GroupCreateForm } from "@/features/hoondok/together/components/group-create-form";

export default async function HoondokGroupNewPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string | string[] }>;
}) {
  if (!isHoondokTogetherEnabled()) notFound();
  const { created } = await searchParams;
  return <GroupCreateForm today={formatKstDate().iso} createdId={typeof created === "string" ? created : null} />;
}
