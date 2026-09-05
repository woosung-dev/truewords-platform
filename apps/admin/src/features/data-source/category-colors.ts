/**
 * DB의 color 키워드를 디자인 시스템 토큰 기반 Tailwind 클래스로 매핑.
 * 옵션 A 톤다운: hue 7가지 유지하되 saturation 을 낮춰 paper 배경 친화.
 * active 상태는 모든 카테고리 동일 brass(--accent) ring 으로 통일.
 *
 * 토큰 정의: admin/src/app/globals.css 의 --tw-cat-* (light) / .dark 의 --tw-cat-* (dark)
 */

const ACTIVE_RING = "ring-2 ring-accent border-accent";

const COLOR_MAP: Record<
  string,
  { text: string; bg: string; border: string; activeRing: string }
> = {
  indigo: {
    text: "text-cat-indigo",
    bg: "bg-cat-indigo/10",
    border: "border-cat-indigo/25",
    activeRing: ACTIVE_RING,
  },
  violet: {
    text: "text-cat-violet",
    bg: "bg-cat-violet/10",
    border: "border-cat-violet/25",
    activeRing: ACTIVE_RING,
  },
  blue: {
    text: "text-cat-blue",
    bg: "bg-cat-blue/10",
    border: "border-cat-blue/25",
    activeRing: ACTIVE_RING,
  },
  slate: {
    text: "text-cat-slate",
    bg: "bg-cat-slate/10",
    border: "border-cat-slate/25",
    activeRing: ACTIVE_RING,
  },
  emerald: {
    text: "text-cat-emerald",
    bg: "bg-cat-emerald/10",
    border: "border-cat-emerald/25",
    activeRing: ACTIVE_RING,
  },
  amber: {
    text: "text-cat-amber",
    bg: "bg-cat-amber/10",
    border: "border-cat-amber/25",
    activeRing: ACTIVE_RING,
  },
  rose: {
    text: "text-cat-rose",
    bg: "bg-cat-rose/10",
    border: "border-cat-rose/25",
    activeRing: ACTIVE_RING,
  },
};

const FALLBACK = COLOR_MAP.slate;

export function getCategoryColors(colorKey: string) {
  return COLOR_MAP[colorKey] ?? FALLBACK;
}
