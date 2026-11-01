import { createApiClient } from "@truewords/api-client-ts";
import { hoondokFetch } from "./observability/report";

// 훈독 브라우저 API client — 같은 origin 프록시 `/api/backend` + 쿠키, 5xx 는 오류 수집(hoondokFetch).
// lib/api.ts 의 공용 client 는 401 에 /login(시연 챗)으로 보내므로 훈독은 이 client 만 쓴다.
// POST·PUT·PATCH·DELETE 의 X-Requested-With 와 credentials 는 SDK transport 가 붙인다.
export const HOONDOK_API_BASE = "/api/backend";

export const { request: hoondokRequest } = createApiClient({ baseUrl: HOONDOK_API_BASE, fetch: hoondokFetch });
