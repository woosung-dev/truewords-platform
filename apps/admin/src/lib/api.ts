import { createApiClient } from "@truewords/api-client-ts";

export { ApiError, throwApiError } from "@truewords/api-client-ts";
export type { ApiErrorPayload } from "@truewords/api-client-ts";

// SDK는 플랫폼 중립이다. 로그인 이동은 각 앱이 소유한다.
export const api = createApiClient({
  onUnauthorized: () => {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  },
});

export const fetchAPI = api.request;
