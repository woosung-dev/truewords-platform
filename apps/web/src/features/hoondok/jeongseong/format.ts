import type { JeongseongDuration, JeongseongPeriodResponse } from "@/features/hoondok/jeongseong-api";

// 정성 기간(SCR-PWA-004·002) 표시·검증용 순수 함수. 문구·목록의 원본은 프로토타입 hoondok-ds/app.html
// `#sheet-jeongseong` 이고, 날짜 규칙의 원본은 API-HD-009(시작일 = 오늘 ~ 오늘+30, KST)다.

/** 기간 선택지. 프로토타입 `<b>7</b><span>일 · 한 주</span>` 구조를 그대로 옮긴다. */
export const DURATION_OPTIONS: ReadonlyArray<{ days: JeongseongDuration; note: string }> = [
  { days: 7, note: "일 · 한 주" },
  { days: 21, note: "일 · 세 주" },
  { days: 40, note: "일 · 정성" },
];

/** 기본 기간 — 프로토타입에서 21일이 `aria-checked="true"` 다. */
export const DEFAULT_DURATION: JeongseongDuration = 21;

/** 주제 칩. 프로토타입의 6번째 칩 "직접 입력" 은 주제 입력칸 자체라 칩에서 뺐다. */
export const TOPIC_CHIPS = ["가정의 화목", "자녀", "감사", "건강", "뜻길"] as const;

/** 주제 최대 길이 (API-HD-009 는 1~40자). */
export const TOPIC_MAX_LENGTH = 40;

/** 나의 각오 최대 길이 (API-HD-009 는 앞뒤 공백을 지운 뒤 0~50자). */
export const RESOLUTION_MAX_LENGTH = 50;

/** 시작일 입력의 min·max. ISO 문자열만 다뤄 브라우저 로컬 타임존에 흔들리지 않는다. */
export function startRange(todayIso: string): { min: string; max: string } {
  const [year, month, day] = todayIso.split("-").map(Number);
  const max = new Date(Date.UTC(year, month - 1, day + 30));
  return { min: todayIso, max: max.toISOString().slice(0, 10) };
}

/** "2026-10-09" → "10월 9일". 시작 전(upcoming) 배지에 쓴다. */
export function formatMonthDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

export type JeongseongDayProgress = {
  /** 오늘이 몇 일차인지 (1 ~ 기간) */
  day: number;
  /** 오늘 뒤로 남은 날 수 (0 이면 오늘이 마지막 날) */
  remainingDays: number;
  /** 막대 길이 % = 일차 / 기간 */
  percent: number;
};

/**
 * 날짜 기준 진행. 읽은 날 수(`done_days`·`percent`)는 쓰지 않는다 — "N일차" 와 나란히 두면 빼기로
 * 빠진 날이 드러난다 (DEC-PWA-023). end_on = started_on + (기간 - 1) 이고 remaining = end_on - 오늘(KST) 이라
 * 일차 = 기간 - remaining 이다. 시작 전이면 null, 끝난 뒤에는 마지막 날에 멈춘다.
 */
export function jeongseongDayProgress(
  period: Pick<JeongseongPeriodResponse, "duration_days" | "progress">,
): JeongseongDayProgress | null {
  if (period.progress.state === "upcoming") return null;
  const duration = period.duration_days;
  const day = Math.min(Math.max(duration - period.progress.remaining_days, 1), duration);
  return { day, remainingDays: duration - day, percent: Math.round((day * 100) / duration) };
}
