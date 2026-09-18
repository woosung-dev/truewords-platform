// 편성일(reading_date)은 KST 날짜 문자열이다. `new Date("YYYY-MM-DD")` 로 로컬 시간대에 얹으면
// UTC+9 서쪽 브라우저에서 하루 전으로 밀리므로, 여기서는 문자열과 UTC 산술만 쓴다.
// web 의 formatKstDate 와 같은 방식이지만 앱 간 import 금지라 admin 이 따로 소유한다.

/** 목록 기본 범위: 오늘 + 14일 (API-HD-006 기본값과 같다). */
export const LIST_DAYS = 14;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** KST 오늘 `YYYY-MM-DD`. 서버 `today_kst()` 와 같은 날짜를 낸다. */
export function kstTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `YYYY-MM-DD` 형식이고 실제 존재하는 날짜인지 (2026-02-30 은 거부). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 날짜 문자열에 n일 더하기. 월·연 경계는 Date.UTC 가 넘긴다. */
export function addDays(iso: string, n: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10);
}

/** from 부터 days 일 뒤까지(포함) 날짜 배열 — 목록의 빈 날("미편성") 행을 만든다. */
export function dateRange(fromIso: string, days: number): string[] {
  return Array.from({ length: days + 1 }, (_, i) => addDays(fromIso, i));
}

/** "9/19 (금)" — 요일은 같은 날짜의 UTC 정오로 계산해 시간대 영향이 없다. */
export function formatDayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
  return `${month}/${day} (${weekday})`;
}
