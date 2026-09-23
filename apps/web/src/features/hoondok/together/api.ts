import { createApiClient } from "@truewords/api-client-ts";
import type { TogetherTodayResponse } from "@truewords/api-client-ts/types";
import { hoondokFetch } from "../observability/report";

// 함께 읽는 사람들 1단계 — 익명 숫자 (API-HD-029, PLAN-HD-009). 공개 엔드포인트라 비로그인 홈에서도 부른다.
// 서버가 기준(threshold) 미만이면 count 를 null 로 주므로 화면은 숫자를 지어내지 않는다.
export type { TogetherTodayResponse };

const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });

export const togetherAPI = {
  today: () => request<TogetherTodayResponse>("/hoondok/today/together"),
};
