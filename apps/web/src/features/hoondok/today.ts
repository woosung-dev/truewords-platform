// 오늘 말씀 화면 모델 (API-HD-001 `GET /hoondok/today` 의 공개 필드와 같다).
// Phase 1 sub-PR 3 에서 생성 SDK 타입으로 교체하고, 화면은 이 형태만 본다.
export type AuthorityGrade = "O1" | "O2" | "O3" | "O4" | "O5" | "R";
export type ReviewStatus = "reviewed" | "unverified" | "withdrawn";

export type TodayReading = {
  id: string;
  reading_date: string;
  title: string;
  body: string;
  speaker: string;
  spoken_on: string | null;
  work_title: string;
  edition: string | null;
  authority_grade: AuthorityGrade;
  review_status: ReviewStatus;
  estimated_minutes: number;
};

export type TodayStatus = "available" | "none" | "withdrawn";

export type TodayResponse = {
  date: string;
  status: TodayStatus;
  reading: TodayReading | null;
};

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
