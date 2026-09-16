import { formatKstDate, type TodayResponse } from "./today";

// 오늘 말씀 조회. Phase 1 sub-PR 3 에서 `GET /hoondok/today`(API-HD-001) 호출로 바뀐다.
// 그 전까지는 AC-016-04 "편성 없음" 상태를 돌려 화면 골격을 검증한다.
export async function loadToday(): Promise<TodayResponse> {
  return { date: formatKstDate().iso, status: "none", reading: null };
}
