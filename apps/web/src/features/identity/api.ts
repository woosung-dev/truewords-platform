import { hoondokRequest as request } from "@/features/hoondok/api-client";
import type { LoginRequest, OAuthStartRequest, OAuthStartResponse, UserEnvelope } from "./types";

// 훈독 계정 API (쿠키 hoondok_token). 401 처리는 features/identity/gate.ts 가 /onboarding 으로 한다.
// 비밀번호 가입(POST /signup)은 서버가 410 으로 닫았으므로 호출하지 않는다.

export const identityAPI = {
  login: (body: LoginRequest) =>
    request<UserEnvelope>("/hoondok/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<Record<string, never>>("/hoondok/auth/logout", { method: "POST" }),
  me: () => request<UserEnvelope>("/hoondok/auth/me"),
  /** 소셜 로그인·연결 시작 — 공급자 인증 주소를 받는다. 콜백은 서버가 처리하고 /onboarding/done 으로 보낸다. */
  oauthStart: (provider: string, body: OAuthStartRequest) =>
    request<OAuthStartResponse>(`/hoondok/auth/oauth/${encodeURIComponent(provider)}/start`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** 로그인 수단 해제. 마지막 수단이면 409 LAST_LOGIN_METHOD. */
  unlinkIdentity: async (identityId: string): Promise<void> => {
    await request<Record<string, never>>(`/hoondok/auth/identities/${encodeURIComponent(identityId)}`, {
      method: "DELETE",
    });
  },
  /** 내 데이터 삭제 (API-HD-011) — 204 + 쿠키 삭제. 캐시·로컬 정리는 use-delete-me.ts 가 한다. */
  deleteMe: async (): Promise<void> => {
    await request<Record<string, never>>("/hoondok/auth/me", { method: "DELETE" });
  },
};
