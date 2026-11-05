import type { MissionCompleteResponse, SummaryResponse } from "@truewords/api-client-ts/types";
import { hoondokRequest as request } from "./api-client";

// 미션 완료·요약 (API-HD-004·005). 브라우저에서 쿠키와 함께 /api/backend 프록시로 간다.
export type MissionKind = MissionCompleteResponse["kind"];
export type { MissionCompleteResponse, SummaryResponse };

export const missionsAPI = {
  complete: (kind: MissionKind) =>
    request<MissionCompleteResponse>(`/hoondok/missions/${kind}/complete`, { method: "POST" }),
  summary: () => request<SummaryResponse>("/hoondok/me/summary"),
};
