// 나의 책갈피 부채 (SCR-PWA-026) 의 모양 계산. 카드는 카드 아래 바깥의 공통 회전축을 중심으로 다이얼처럼 돌고,
// 고른 카드는 늘 가운데에 똑바로 선다. 화면(무대) 크기에 맞춰 카드 폭·펼침 각도를 고른다 — DOM 없이 테스트할 수 있게 순수 함수로 둔다.
// 좌표: 회전축이 원점, y 는 위쪽(+), 각도는 도(deg)이고 +가 오른쪽으로 기운다.

/** 맨 끝 카드 뒤에 비껴 쌓인 카드끼리의 각도(도) */
const TUCK = 2.6;
/** 가운데서 한 칸 멀어질 때마다 줄어드는 비율 */
const SHRINK = 0.045;
/** 카드 비율(피드 4:5) */
const CARD_RATIO = 1.25;

export type FanGeometry = {
  /** 카드 폭·높이(px) */
  W: number;
  H: number;
  /** 회전축에서 카드 아래 가장자리까지 거리 */
  d: number;
  /** 이웃 카드 사이 각도(도). 1장이면 0 */
  s: number;
  /** 가운데 카드를 들어 올리는 높이 */
  lift: number;
  /** 한쪽에 또렷이 펼치는 카드 수(최대 3). 그 너머는 맨 끝 카드 뒤에 쌓는다 */
  k: number;
  /** 부채 테두리(회전축 기준). 어느 카드가 가운데 와도 같은 틀이라 넘길 때 크기가 흔들리지 않는다 */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type FanPose = { angle: number; scale: number; lift: number; dim: number; opacity: number };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** 가운데에서 offset 칸 떨어진 카드의 자세. 멀수록 더 기울고 작고 어둡다 */
export function fanPose(offset: number, g: Pick<FanGeometry, "s" | "lift" | "k">): FanPose {
  const a = Math.abs(offset);
  const sign = Math.sign(offset);
  const { k } = g;
  const angle = a <= k ? offset * g.s : sign * (k * g.s + (a - k) * TUCK);
  // 가운데 카드는 한 단 크게(들린 느낌), 그다음부터는 조금씩 작게
  const scale = 1 - 0.1 * Math.min(a, 1) - SHRINK * Math.max(0, Math.min(a, k + 1) - 1);
  const lift = g.lift * Math.max(0, 1 - a);
  const dim = Math.min(a, k + 1) * (0.36 / (k + 1)) + 0.08 * Math.min(a, 1);
  const opacity = a <= k + 1.5 ? 1 : Math.max(0, 1 - (a - k - 1.5));
  return { angle, scale, lift, dim, opacity };
}

/** 회전축 기준 카드 네 모서리 [왼위, 오위, 오아래, 왼아래] (y 위쪽) */
function corners(g: Pick<FanGeometry, "W" | "H" | "d">, p: FanPose): [number, number][] {
  const cy = g.d + g.H / 2 + p.lift;
  const t = rad(p.angle);
  return (
    [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ] as const
  ).map(([sx, sy]) => {
    const x = ((sx * g.W) / 2) * p.scale;
    const y = cy + ((sy * g.H) / 2) * p.scale;
    return [x * Math.cos(t) + y * Math.sin(t), -x * Math.sin(t) + y * Math.cos(t)];
  });
}

/** 카드 폭 W 일 때의 부채. 옆 카드가 가운데 카드 밖으로 누를 수 있는 띠만큼 내밀도록 각도를 찾는다 */
export function fanGeometry(W: number, count: number, isWide: boolean): FanGeometry {
  const H = W * CARD_RATIO;
  const k = Math.max(0, Math.min(3, count - 1));
  const g = { W, H, d: H * (isWide ? 0.7 : 0.62), s: 0, lift: H * 0.035, k };
  if (k > 0) {
    // 옆 카드가 가운데 카드 밖으로 내미는 폭(누를 수 있는 띠)
    const strip = Math.min(110, Math.max(46, W * (k <= 2 ? (isWide ? 0.3 : 0.24) : 0.2)));
    let lo = 1;
    let hi = 28;
    for (let i = 0; i < 30; i++) {
      g.s = (lo + hi) / 2;
      const edge0 = corners(g, fanPose(0, g))[1][0];
      const edge1 = corners(g, fanPose(1, g))[1][0];
      if (edge1 - edge0 < strip) lo = g.s;
      else hi = g.s;
    }
    g.s = hi;
  }
  // 좁은 화면에서 7장이면 맨 바깥 한 장(±3)은 화면 끝에 반쯤 걸치게 둔다. 그래야 가운데 카드가 작아지지 않는다
  const kFit = isWide ? k : Math.min(k, 2);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let o = -kFit; o <= kFit; o++) {
    for (const [x, y] of corners(g, fanPose(o, g))) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { ...g, minX, maxX, minY, maxY };
}

/** 주어진 가로·세로 안에 들어가는 가장 큰 부채 */
export function fitFan({
  count,
  availW,
  availH,
  isWide,
}: {
  count: number;
  availW: number;
  availH: number;
  isWide: boolean;
}): FanGeometry {
  const maxW = count === 1 ? (isWide ? 320 : 250) : isWide ? 340 : 300;
  let lo = 110;
  let hi = maxW;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const g = fanGeometry(mid, count, isWide);
    if (g.maxX - g.minX <= availW && g.maxY - g.minY <= availH) lo = mid;
    else hi = mid;
  }
  return fanGeometry(lo, count, isWide);
}

/** 한 장 넘긴 자리. 끝에서 더 넘기면 null(돌아 감기 없음 — 화면은 부채를 살짝 밀었다 돌려놓는다) */
export function stepIndex(current: number, dir: -1 | 1, count: number): number | null {
  const target = current + dir;
  return target < 0 || target > count - 1 ? null : target;
}

/** 손가락을 이만큼(px) 밀면 한 장 넘어간다 — 카드 위쪽 한 칸 거리 */
export function dragUnit(g: Pick<FanGeometry, "H" | "d" | "s">): number {
  return Math.max(70, (g.d + g.H) * Math.sin(rad(Math.max(g.s, 6))));
}

/** 드래그 중 자리(소수). 끝 너머로는 30% 만 따라가 고무줄처럼 버틴다 */
export function dragPosition(start: number, dx: number, unit: number, count: number): number {
  const p = start - dx / unit;
  if (p < 0) return p * 0.3;
  if (p > count - 1) return count - 1 + (p - (count - 1)) * 0.3;
  return p;
}

/** 손을 뗀 자리. 빠르기(px/ms)를 더하되 휙 넘겨도 한 번에 한 장만 더 간다 */
export function releaseIndex(pos: number, velocity: number, unit: number, count: number): number {
  const fling = Math.max(-1, Math.min(1, (velocity * 120) / unit));
  return Math.max(0, Math.min(count - 1, Math.round(pos - fling)));
}
