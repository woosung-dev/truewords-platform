// /hoondok/groups/join?code= — SCR-PWA-018 모임 참여 (PLAN-HD-010 W1). 킬 스위치 OFF 면 404(D3).
// 코드는 서버에서 쿼리로 읽어 넘긴다 — 클라이언트 useSearchParams 의 Suspense 경계가 필요 없다.
import { notFound } from "next/navigation";
import { isHoondokTogetherEnabled } from "@/features/hoondok/flag";
import { GroupJoinForm } from "@/features/hoondok/together/components/group-join-form";

export default async function HoondokGroupJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  if (!isHoondokTogetherEnabled()) notFound();
  const { code } = await searchParams;
  return <GroupJoinForm initialCode={typeof code === "string" ? code.slice(0, 64) : null} />;
}
