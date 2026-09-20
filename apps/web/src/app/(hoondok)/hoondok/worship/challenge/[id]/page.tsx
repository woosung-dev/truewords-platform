// /hoondok/worship/challenge/[id] — SCR-PWA-011 챌린지 상세 (PLAN-HD-002 W3-W).
// fixture 에 없는 id 는 404 다 — 프리뷰라도 없는 챌린지를 빈 화면으로 꾸며 내지 않는다 (REQ-PWA-013).
import { notFound } from "next/navigation";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { findPreviewChallenge } from "@/features/hoondok/preview/fixtures/worship";
import { ChallengeDetail } from "@/features/hoondok/worship/components/challenge-detail";

export default async function HoondokChallengePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isHoondokPreviewEnabled()) notFound();
  const { id } = await params;
  const challenge = findPreviewChallenge(id);
  if (!challenge) notFound();
  return <ChallengeDetail challenge={challenge} />;
}
