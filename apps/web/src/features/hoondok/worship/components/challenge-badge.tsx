import type { PreviewChallenge } from "@/features/hoondok/preview/fixtures/worship";

// 챌린지 상태 배지 (D-day · 모집 중). 권위 등급 배지(AuthorityBadge)와 다른 축이라 같은 줄에 두지 않는다.
// 순위·점수를 뜻하는 변형은 만들지 않는다 (DEC-PWA-019).
const TONE_CLASS: Record<PreviewChallenge["badge"]["tone"], string> = {
  accent: "badge badge--accent",
  plain: "badge",
  line: "badge badge--line",
};

export function ChallengeBadge({ badge }: { badge: PreviewChallenge["badge"] }) {
  return <span className={TONE_CLASS[badge.tone]}>{badge.label}</span>;
}
