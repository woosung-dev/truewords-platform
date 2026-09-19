import type { JeongseongDuration } from "@/features/hoondok/jeongseong-api";

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

/** 기본 알림 시각(표시·저장용). 프로토타입 "오전 5:30". */
export const DEFAULT_REMINDER = "05:30";

/** 주제 칩. 프로토타입의 6번째 칩 "직접 입력" 은 주제 입력칸 자체라 칩에서 뺐다. */
export const TOPIC_CHIPS = ["가정의 화목", "자녀", "감사", "건강", "뜻길"] as const;

/** 주제 최대 길이 (API-HD-009 는 1~40자). */
export const TOPIC_MAX_LENGTH = 40;

/** 시작일 입력의 min·max. ISO 문자열만 다뤄 브라우저 로컬 타임존에 흔들리지 않는다. */
export function startRange(todayIso: string): { min: string; max: string } {
  const [year, month, day] = todayIso.split("-").map(Number);
  const max = new Date(Date.UTC(year, month - 1, day + 30));
  return { min: todayIso, max: max.toISOString().slice(0, 10) };
}

/** "05:30:00" → "5:30". 서버는 초까지 주고 화면은 프로토타입처럼 앞 0 을 뗀다. 형식이 아니면 null. */
export function formatReminder(raw: string | null | undefined): string | null {
  const match = /^(\d{1,2}):([0-5]\d)/.exec(raw ?? "");
  return match ? `${Number(match[1])}:${match[2]}` : null;
}

/** "2026-10-09" → "10월 9일". 시작 전(upcoming) 배지에 쓴다. */
export function formatMonthDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}
