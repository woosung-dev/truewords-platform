import { createApiClient } from "@truewords/api-client-ts";
import type { MonthHistoryResponse, WeekDay } from "@truewords/api-client-ts/types";
import { hoondokFetch } from "./observability/report";

// 월별 훈독 기록 (API-HD-010). 나의 정원 달력이 쓴다. `days[]` 는 요약의 `week[]` 와 같은 WeekDay.
export type { MonthHistoryResponse, WeekDay };

const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });

export const historyAPI = {
  /** month 는 `YYYY-MM`. 생략하면 서버가 오늘(KST)의 월을 쓴다. 형식 위반·범위 밖은 422. */
  month: (month?: string) =>
    request<MonthHistoryResponse>(
      month ? `/hoondok/me/history?month=${encodeURIComponent(month)}` : "/hoondok/me/history",
    ),
};
