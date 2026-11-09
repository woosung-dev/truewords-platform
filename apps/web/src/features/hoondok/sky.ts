// 홈 "오늘의 하늘" (SCR-PWA-002) 순수 함수. 시간대는 앱의 날짜 판정과 같은 KST 로 고른다.
// KST 는 서머타임이 없는 UTC+9 고정이라 시각 계산에 Intl 없이 9시간을 더한다.

export type SkySlot = "dawn" | "day" | "dusk" | "night";

const KST_OFFSET_MS = 9 * 3_600_000;
/** 시간대가 바뀌는 KST 시각. 새벽 4~7, 낮 7~17, 저녁 17~20, 그 밖은 밤 */
const BOUNDARY_HOURS = [4, 7, 17, 20] as const;

export function skySlotAt(now: Date = new Date()): SkySlot {
  const hour = new Date(now.getTime() + KST_OFFSET_MS).getUTCHours();
  if (hour >= 4 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/** 다음 시간대 경계(KST)까지 남은 밀리초. 열어 둔 화면이 경계에서 하늘을 바꿀 때 쓴다 */
export function msUntilNextSlot(now: Date = new Date()): number {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const hour = kst.getUTCHours();
  const next = BOUNDARY_HOURS.find((boundary) => boundary > hour) ?? BOUNDARY_HOURS[0] + 24;
  const kstMidnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return kstMidnight + next * 3_600_000 - kst.getTime();
}

/** 이번 주 별자리 선: 월요일부터 7칸 중 연속으로 이어진 두 날끼리만 잇는다. 빈 날을 건너 잇지 않는다 */
export function constellationLinks(doneByDay: readonly boolean[]): [number, number][] {
  const links: [number, number][] = [];
  for (let index = 0; index < 6; index += 1) {
    if (doneByDay[index] && doneByDay[index + 1]) links.push([index, index + 1]);
  }
  return links;
}

/**
 * 별 7개 자리(월→일, %). narrow 는 하늘 안 별자리 상자 기준(좁은 화면),
 * wide 는 1024px 이상에서 하늘 전체 기준 — 왼쪽 아래(월)에서 오른쪽 위(일)로 대각선을 그린다.
 */
export const STAR_POINTS = [
  { narrow: [6, 46], wide: [4, 63] },
  { narrow: [21, 30], wide: [15, 58] },
  { narrow: [36, 48], wide: [27, 64] },
  { narrow: [51, 20], wide: [38, 50] },
  { narrow: [66, 40], wide: [50, 41] },
  { narrow: [80, 14], wide: [62, 30] },
  { narrow: [93, 26], wide: [76, 19] },
] as const satisfies readonly { narrow: readonly [number, number]; wide: readonly [number, number] }[];

/** 바탕 잔별. 고정 씨앗이라 서버·클라이언트가 같은 자리를 그린다(hydration 일치) */
export const FIELD_STARS: readonly { left: string; top: string; size: string; alpha: string; isTwinkle: boolean }[] =
  (() => {
    let seed = 20261109;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    return Array.from({ length: 70 }, () => ({
      isTwinkle: next() < 0.2,
      left: `${(next() * 100).toFixed(2)}%`,
      top: `${(next() * 100).toFixed(2)}%`,
      size: `${(1 + next() * 1.6).toFixed(2)}px`,
      alpha: (0.35 + next() * 0.6).toFixed(2),
    }));
  })();
