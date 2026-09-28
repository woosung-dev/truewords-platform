// 책갈피 모션 (PLAN-HD-012, 승인 시안 bookmark-final 의 "모션 타이밍" 표를 그대로 옮김).
// 원칙: transform·opacity 만 움직인다. 동작 줄이기 설정이면 모든 전환을 opacity 페이드 하나로 바꾼다.
// 단계는 데이터(Step[])로 만들고 컴포넌트가 ref 로 요소를 골라 Web Animations API 로 재생한다 — 분기를 테스트할 수 있게.

export type MotionTarget =
  | "moment" // 받는 순간 무대(날짜·제목·책·캡션)
  | "book" // 무대 속 책 묶음
  | "cover"
  | "glow"
  | "rib" // 책 속 리본(술 포함)
  | "tassel"
  | "caption"
  | "card" // 읽기 카드
  | "veil" // 카드 위 감귤 막
  | "inner" // 카드 속 글자
  | "ui" // 카드 아래 버튼 묶음
  | "page" // 원문 단락
  | "ribbon" // 원문 왼쪽 리본 끈
  | "underline"; // 원문 밑줄

export type Step = {
  target: MotionTarget;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions & { duration: number; delay?: number };
};

export const E_OUT = "cubic-bezier(.2,.8,.2,1)";
export const E_POP = "cubic-bezier(.2,.9,.25,1.12)";
export const E_IN = "cubic-bezier(.5,0,.75,.2)";

const fade = (target: MotionTarget, from: number, to: number, duration: number, delay = 0): Step => ({
  target,
  keyframes: [{ opacity: from }, { opacity: to }],
  options: { duration, delay, easing: E_OUT },
});

/** 동작 줄이기 설정. 서버 렌더·matchMedia 없는 환경은 false. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 스텝 묶음이 끝나는 시각(ms). */
export function totalDuration(steps: readonly Step[]): number {
  return steps.reduce((max, step) => Math.max(max, (step.options.delay ?? 0) + step.options.duration), 0);
}

/**
 * ② 받는 순간 (약 1.56초). flipStart 는 리본 자리 → 카드 자리 FLIP 시작 transform 이다.
 * 책 벌어짐(0–320) → 책갈피 상승(240–760) → 술 흔들림(700–1180) → 카드로 펼침(1000–1480) → 글자 등장(1280–1560).
 */
export function receiveSteps({ reduced, flipStart }: { reduced: boolean; flipStart: string }): Step[] {
  if (reduced)
    return [
      fade("moment", 1, 0, 200),
      fade("card", 0, 1, 200, 200),
      fade("inner", 0, 1, 200, 200),
      fade("ui", 0, 1, 200, 200),
    ];
  return [
    {
      target: "book",
      keyframes: [
        { transform: "translateY(0)", opacity: 1 },
        { transform: "translateY(-4px)", opacity: 1, offset: 0.15 },
        { transform: "translateY(-4px)", opacity: 1, offset: 0.77 },
        { transform: "translateY(30px)", opacity: 0 },
      ],
      options: { duration: 1300, easing: "linear" },
    },
    {
      target: "cover",
      keyframes: [{ transform: "rotateY(0)" }, { transform: "rotateY(-26deg)" }],
      options: { duration: 320, easing: E_OUT },
    },
    fade("glow", 0, 1, 240, 80),
    {
      target: "rib",
      keyframes: [{ transform: "translateY(11em)" }, { transform: "translateY(0)" }],
      options: { duration: 520, delay: 240, easing: E_POP },
    },
    {
      target: "tassel",
      keyframes: [
        { transform: "rotate(0)" },
        { transform: "rotate(14deg)", offset: 0.22 },
        { transform: "rotate(-9deg)", offset: 0.48 },
        { transform: "rotate(5deg)", offset: 0.7 },
        { transform: "rotate(-2deg)", offset: 0.86 },
        { transform: "rotate(0)" },
      ],
      options: { duration: 480, delay: 700, easing: "ease-in-out" },
    },
    {
      target: "caption",
      keyframes: [
        { opacity: 0 },
        { opacity: 0, offset: 0.517 },
        { opacity: 1, offset: 0.717 },
        { opacity: 1, offset: 0.833 },
        { opacity: 0 },
      ],
      options: { duration: 1200, easing: "linear" },
    },
    {
      // 1000ms 에 리본과 같은 자리·색으로 카드를 바꿔 끼우고 480ms 동안 카드 크기로 펼친다
      target: "card",
      keyframes: [
        { opacity: 0, transform: flipStart },
        { opacity: 0, transform: flipStart, offset: 0.675 },
        { opacity: 1, transform: flipStart, offset: 0.676, easing: "cubic-bezier(.3,.7,.1,1)" },
        { opacity: 1, transform: "none" },
      ],
      options: { duration: 1480, easing: "linear" },
    },
    {
      target: "veil",
      keyframes: [{ opacity: 1 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }],
      options: { duration: 400, delay: 1000, easing: "linear" },
    },
    {
      target: "rib",
      keyframes: [{ opacity: 1 }, { opacity: 0 }],
      options: { duration: 60, delay: 1000, easing: "linear" },
    },
    fade("moment", 1, 0, 200, 1300),
    fade("inner", 0, 1, 280, 1280),
    fade("ui", 0, 1, 280, 1280),
  ];
}

/**
 * 역방향: 책에 다시 꽂기 (약 0.9초). flipEnd 는 카드 자리 → 리본 자리 transform 이다.
 * 글자 사라짐(0–140) → 감귤 막(100–400) → 카드가 리본 크기로 접힘(120–500) → 책 등장(180–440)
 * → 리본이 책 속으로(500–800) → 표지 닫힘(620–900).
 */
export function foldSteps({ reduced, flipEnd }: { reduced: boolean; flipEnd: string }): Step[] {
  if (reduced) return [fade("card", 1, 0, 200), fade("ui", 1, 0, 200)];
  return [
    fade("ui", 1, 0, 140),
    fade("inner", 1, 0, 140),
    {
      target: "veil",
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      options: { duration: 300, delay: 100, easing: "ease-in" },
    },
    {
      target: "card",
      keyframes: [{ transform: "none" }, { transform: flipEnd }],
      options: { duration: 380, delay: 120, easing: "cubic-bezier(.5,0,.2,1)" },
    },
    fade("moment", 0, 1, 260, 180),
    {
      target: "book",
      keyframes: [{ transform: "translateY(20px)" }, { transform: "translateY(0)" }],
      options: { duration: 260, delay: 180, easing: E_OUT },
    },
    {
      target: "cover",
      keyframes: [
        { transform: "rotateY(-26deg)" },
        { transform: "rotateY(-26deg)", offset: 0.69, easing: E_IN },
        { transform: "rotateY(0)" },
      ],
      options: { duration: 900, easing: "linear" },
    },
    // 500ms: 같은 자리·같은 색이라 카드 → 책 리본으로 바꿔 끼운다. 리본은 표지 뒤로 내려간다
    {
      target: "card",
      keyframes: [{ opacity: 1 }, { opacity: 0 }],
      options: { duration: 1, delay: 500, easing: "linear" },
    },
    {
      target: "rib",
      keyframes: [{ transform: "translateY(0)" }, { transform: "translateY(11.8em)" }],
      options: { duration: 300, delay: 500, easing: E_IN },
    },
  ];
}

/**
 * 원문 펼침 (약 0.9초): 쪽 translateY 16 → 0 + opacity(0–320) → 리본 끈 scaleY 0 → 1(200–620) → 밑줄(560–900).
 * 밑줄은 여러 줄에 걸친 인라인 글자라 scaleX 대신 opacity 로 나타난다(시안과 다른 점).
 */
export function pageSteps(reduced: boolean): Step[] {
  if (reduced) return [fade("page", 0, 1, 300)];
  return [
    {
      target: "page",
      keyframes: [
        { opacity: 0, transform: "translateY(16px)" },
        { opacity: 1, transform: "none" },
      ],
      options: { duration: 320, easing: E_OUT },
    },
    {
      target: "ribbon",
      keyframes: [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }],
      options: { duration: 420, delay: 200, easing: E_OUT },
    },
    fade("underline", 0, 1, 340, 560),
  ];
}

/** 책갈피 다시 꺼내기 — 원문 쪽: 리본 끈 scaleY 1 → 0 (0–220). 동작 줄이기면 움직임 없이 바로 넘어간다. */
export function pulloutExitSteps(reduced: boolean): Step[] {
  if (reduced) return [];
  return [
    {
      target: "ribbon",
      keyframes: [{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }],
      options: { duration: 220, easing: E_IN },
    },
  ];
}

/** 책갈피 다시 꺼내기 — 읽기 쪽: 카드 translateY 48 → 0 + opacity (0–340), 버튼 페이드(120–360). */
export function pulloutEnterSteps(reduced: boolean): Step[] {
  if (reduced) return [fade("card", 0, 1, 200)];
  return [
    {
      target: "card",
      keyframes: [
        { opacity: 0, transform: "translateY(48px)" },
        { opacity: 1, transform: "none" },
      ],
      options: { duration: 340, easing: E_POP },
    },
    fade("ui", 0, 1, 240, 120),
  ];
}

/** 스텝을 재생하고 끝나면 resolve. animate 가 없는 환경(jsdom·구형)은 기다리지 않고 바로 끝난다. */
export async function playSteps(
  steps: readonly Step[],
  resolve: (target: MotionTarget) => Element | null | undefined,
): Promise<void> {
  const animations: Animation[] = [];
  for (const step of steps) {
    const element = resolve(step.target);
    if (!element || typeof element.animate !== "function") continue;
    animations.push(element.animate(step.keyframes, { fill: "both", ...step.options }));
  }
  if (animations.length === 0) return;
  await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
}

/** 재생이 끝난 요소의 fill 을 걷어 CSS 상태로 돌려 놓는다. */
export function clearAnimations(root: Element | null | undefined): void {
  if (!root || typeof root.getAnimations !== "function") return;
  for (const animation of root.getAnimations({ subtree: true })) animation.cancel();
}

/** FLIP: to 요소 기준으로 from 사각형에서 시작하는 transform (transform-origin 0 0 전제). */
export function flipTransform(
  from: DOMRectReadOnly | { x: number; y: number; width: number; height: number },
  to: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
): string {
  if (!to.width || !to.height) return "none";
  return `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}
