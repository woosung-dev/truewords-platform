import type { DailyReadingPublic, TodayReadingResponse } from "@truewords/api-client-ts/types";

// 오늘 말씀 화면 모델 = 생성 SDK 타입 (API-HD-001 `GET /hoondok/today`). 직접 정의하지 않는다.
export type TodayReading = DailyReadingPublic;
export type TodayStatus = TodayReadingResponse["status"];
export type AuthorityGrade = DailyReadingPublic["authority_grade"];
export type ReviewStatus = DailyReadingPublic["review_status"];

/** 화면용 응답. `error` 는 API 를 못 읽었을 때만 있으며 status 는 "none" 으로 둔다. */
export type TodayResponse = TodayReadingResponse & { error?: string };

/** KST 오늘을 `YYYY-MM-DD` 와 "2026. 9. 17. 수" 표기로. 서버·클라이언트 모두 같은 값을 낸다. */
export function formatKstDate(now: Date = new Date()): { iso: string; label: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  const label = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(now);
  // 0=일 … 6=토 (KST 기준). KST 정오 = 같은 날짜 03:00Z 라 UTC 요일이 KST 요일과 같다.
  const weekday = new Date(`${iso}T12:00:00+09:00`).getUTCDay();
  return { iso, label, weekday };
}
