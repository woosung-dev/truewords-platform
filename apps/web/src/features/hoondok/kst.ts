import type { WeekDay } from "@truewords/api-client-ts/types";
import { formatKstDate } from "./today";

// KST 달력 계산 (순수 함수). 월 기록 조회 키와 나의 정원 달력 그리드가 쓴다.

/** KST 기준 `YYYY-MM`. UTC 23:30 은 KST 다음날이라 월 경계도 KST 로 넘어간다. */
export function kstMonthKey(now: Date = new Date()): string {
  return formatKstDate(now).iso.slice(0, 7);
}

/**
 * 월요일 시작 달력 그리드. leadingBlanks 는 1일 앞에 둘 빈 칸 수(월=0 … 일=6).
 * cells 는 API 가 준 그 달의 날들 그대로(1일부터 일수만큼, 미래는 done=false).
 */
export function monthGrid(month: string, days: WeekDay[]): { leadingBlanks: number; cells: WeekDay[] } {
  // 1일 KST 정오 = 같은 날짜 03:00Z 라 UTC 요일이 KST 요일과 같다 (today.ts 와 같은 방식). 0=일 … 6=토
  const weekdayOfFirst = new Date(`${month}-01T12:00:00+09:00`).getUTCDay();
  return { leadingBlanks: (weekdayOfFirst + 6) % 7, cells: days };
}
