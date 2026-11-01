// 답변 모드 5종 — 모드 분포 차트(modes-chart)와 그 본체(modes-bars)가 같이 쓴다.
export const MODES = ["standard", "theological", "pastoral", "beginner", "kids"] as const;
export type Mode = (typeof MODES)[number];
