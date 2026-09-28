// 책갈피 화면의 날짜 표기. 입력은 KST `YYYY-MM-DD`(formatKstDate().iso) — 서버가 계산해 내려 hydration 이 어긋나지 않게 한다.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function parts(iso: string): { year: number; month: number; day: number; weekday: string } {
  const [year, month, day] = iso.split("-").map(Number);
  // KST 정오 = 같은 날짜 03:00Z 라 UTC 요일이 KST 요일과 같다 (today.ts 와 같은 방식)
  const weekday = WEEKDAYS[new Date(`${iso}T12:00:00+09:00`).getUTCDay()] ?? "";
  return { year, month, day, weekday };
}

/** 홈 섹션 머리: "9월 28일 월요일" */
export function cardDayLabel(iso: string): string {
  const { month, day, weekday } = parts(iso);
  return `${month}월 ${day}일 ${weekday}요일`;
}

/** 카드 머리: "2026. 9. 28." */
export function cardDotDate(iso: string): string {
  const { year, month, day } = parts(iso);
  return `${year}. ${month}. ${day}.`;
}

/** 받는 순간 머리: "2026년 9월 28일" */
export function cardLongDate(iso: string): string {
  const { year, month, day } = parts(iso);
  return `${year}년 ${month}월 ${day}일`;
}
