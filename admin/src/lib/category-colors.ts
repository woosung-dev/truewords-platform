/**
 * DB의 color 키워드를 Tailwind 클래스로 매핑.
 * Tailwind는 동적 클래스명을 빌드 시 스캔하지 못하므로 사전 정의 필수.
 */

const COLOR_MAP: Record<
  string,
  { text: string; bg: string; border: string; activeRing: string }
> = {
  indigo: {
    text: "text-indigo-600",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
    activeRing: "ring-2 ring-indigo-500 border-indigo-500",
  },
  violet: {
    text: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-200",
    activeRing: "ring-2 ring-violet-500 border-violet-500",
  },
  blue: {
    text: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
    activeRing: "ring-2 ring-blue-500 border-blue-500",
  },
  slate: {
    text: "text-slate-500",
    bg: "bg-slate-50",
    border: "border-slate-200",
    activeRing: "ring-2 ring-slate-400 border-slate-400",
  },
  emerald: {
    text: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    activeRing: "ring-2 ring-emerald-500 border-emerald-500",
  },
  amber: {
    text: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    activeRing: "ring-2 ring-amber-500 border-amber-500",
  },
  rose: {
    text: "text-rose-600",
    bg: "bg-rose-50",
    border: "border-rose-200",
    activeRing: "ring-2 ring-rose-500 border-rose-500",
  },
};

const FALLBACK = COLOR_MAP.slate;

export function getCategoryColors(colorKey: string) {
  return COLOR_MAP[colorKey] ?? FALLBACK;
}
