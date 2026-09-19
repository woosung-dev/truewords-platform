import { createApiClient } from "@truewords/api-client-ts";
import type { LoginRequest, SignupRequest, UserEnvelope } from "./types";

// 훈독 계정 API (쿠키 hoondok_token). lib/api.ts 의 공용 client 는 401 에 /login(시연 챗)으로 보내므로
// 쓰지 않는다 — 401 처리는 features/identity/gate.ts 가 /hoondok/onboarding 으로 한다.
const { request } = createApiClient({ baseUrl: "/api/backend" });

export const identityAPI = {
  signup: (body: SignupRequest) =>
    request<UserEnvelope>("/hoondok/auth/signup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: LoginRequest) =>
    request<UserEnvelope>("/hoondok/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<Record<string, never>>("/hoondok/auth/logout", { method: "POST" }),
  me: () => request<UserEnvelope>("/hoondok/auth/me"),
  /** 내 데이터 삭제 (API-HD-011) — 204 + 쿠키 삭제. 캐시·로컬 정리는 use-delete-me.ts 가 한다. */
  deleteMe: async (): Promise<void> => {
    await request<Record<string, never>>("/hoondok/auth/me", { method: "DELETE" });
  },
};
