import type {
  PathRunCurrentResponse,
  PathRunFinishRequest,
  PathRunStart,
  PathRunView,
  PathStepCompleteRequest,
  PathStepCompleteResponse,
  PathStepContentResponse,
  PathStepSummary,
  ReadingPathListResponse,
  ReadingPathSummary,
} from "@truewords/api-client-ts/types";
import { hoondokRequest as request } from "../api-client";

// 7일 정성 (API-HD-062~065). 브라우저에서 쿠키와 함께 /api/backend 프록시로 간다.
// POST·DELETE 에 필요한 X-Requested-With 는 createApiClient 의 transport 가 붙인다.
export type {
  PathRunFinishRequest,
  PathRunStart,
  PathRunView,
  PathStepContentResponse,
  PathStepSummary,
  ReadingPathSummary,
};
export type MinutesTier = PathRunStart["minutes_tier"];
export type PreferredSlot = NonNullable<PathRunStart["preferred_slot"]>;

const RUNS = "/hoondok/me/path-runs";
const CURRENT = `${RUNS}/current`;

export const pathAPI = {
  list: () => request<ReadingPathListResponse>("/hoondok/paths"),
  current: () => request<PathRunCurrentResponse>(CURRENT, { cache: "no-store" }),
  /** 시작 — 201. 409 PATH_RUN_ACTIVE·JEONGSEONG_ACTIVE · 403 RIGHTS_CLOSED. */
  start: (body: PathRunStart) => request<PathRunCurrentResponse>(RUNS, { method: "POST", body: JSON.stringify(body) }),
  /** 그만하기 — 204. */
  abandon: async (): Promise<void> => {
    await request<Record<string, never>>(CURRENT, { method: "DELETE" });
  },
  step: (day: number) => request<PathStepContentResponse>(`${CURRENT}/steps/${day}`, { cache: "no-store" }),
  /** 같은 장 재요청은 200 기존 값. 409 ALREADY_READ_TODAY·STEP_OUT_OF_ORDER. */
  complete: (day: number, body: PathStepCompleteRequest = { mode: "full" }) =>
    request<PathStepCompleteResponse>(`${CURRENT}/steps/${day}/complete`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  finish: (body: PathRunFinishRequest) =>
    request<PathRunCurrentResponse>(`${CURRENT}/finish`, { method: "POST", body: JSON.stringify(body) }),
};
