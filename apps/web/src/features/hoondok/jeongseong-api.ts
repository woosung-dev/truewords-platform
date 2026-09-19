import { createApiClient } from "@truewords/api-client-ts";
import type {
  JeongseongCreate,
  JeongseongCurrentResponse,
  JeongseongPeriodResponse,
} from "@truewords/api-client-ts/types";

// 정성 기간 (API-HD-009). 브라우저에서 쿠키와 함께 /api/backend 프록시로 간다.
// POST·DELETE 에 필요한 X-Requested-With 는 createApiClient 의 transport 가 붙인다.
export type { JeongseongCreate, JeongseongCurrentResponse, JeongseongPeriodResponse };
export type JeongseongProgress = JeongseongPeriodResponse["progress"];
export type JeongseongDuration = JeongseongCreate["duration_days"];

const { request } = createApiClient({ baseUrl: "/api/backend" });

const PATH = "/hoondok/me/jeongseong";

export const jeongseongAPI = {
  /** 진행 중인 기간 + 진행률. 없으면 `{ period: null }`. */
  current: () => request<JeongseongCurrentResponse>(PATH),
  /** 시작 — 201. 409 이미 진행 중 · 422 검증 · 401 미인증. */
  create: (body: JeongseongCreate) =>
    request<JeongseongPeriodResponse>(PATH, { method: "POST", body: JSON.stringify(body) }),
  /** 그만두기 — 204. 진행 중인 기간이 없으면 404 ApiError. */
  abandon: async (): Promise<void> => {
    await request<Record<string, never>>(PATH, { method: "DELETE" });
  },
};
