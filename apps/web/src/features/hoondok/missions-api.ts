import { createApiClient } from "@truewords/api-client-ts";
import type { MissionCompleteResponse, SummaryResponse } from "@truewords/api-client-ts/types";
import { hoondokFetch } from "./observability/report";

// 미션 완료·요약 (API-HD-004·005). 브라우저에서 쿠키와 함께 /api/backend 프록시로 간다.
export type MissionKind = MissionCompleteResponse["kind"];
export type { MissionCompleteResponse, SummaryResponse };

const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });

export const missionsAPI = {
  complete: (kind: MissionKind) =>
    request<MissionCompleteResponse>(`/hoondok/missions/${kind}/complete`, { method: "POST" }),
  summary: () => request<SummaryResponse>("/hoondok/me/summary"),
};
