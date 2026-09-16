import { createApiClient } from "@truewords/api-client-ts";
import { formatKstDate, type TodayResponse } from "./today";

// 오늘 말씀 조회 (API-HD-001 `GET /hoondok/today`). 서버 컴포넌트에서 호출하므로 브라우저 프록시
// `/api/backend` 가 아니라 API origin(NEXT_PUBLIC_API_URL: 운영 http://backend:8080, E2E 127.0.0.1:8000)에
// 직접 간다. 공개 엔드포인트라 쿠키가 필요 없고, 응답은 요청마다 새로 받는다(캐시 없음).
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function loadToday(fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<TodayResponse> {
  const { request } = createApiClient({ baseUrl: API_ORIGIN, fetch: fetchImpl });
  try {
    return await request<TodayResponse>("/hoondok/today", { cache: "no-store" });
  } catch (error) {
    // 네트워크·서버 오류: AC-016-04 와 같은 "없음" 화면을 쓰되 원인은 error 로 구분한다.
    return {
      date: formatKstDate().iso,
      status: "none",
      reading: null,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}
