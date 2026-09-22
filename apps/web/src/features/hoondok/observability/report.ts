// 원문·질문·검색어·예외 객체를 받지 않는다. 허용된 코드와 경로 템플릿만 전송한다.
import type { ClientErrorInput } from "@truewords/api-client-ts/types";
// "push_subscribe" 는 PLAN-HD-006 backend 가 받는 kind 다. contracts 재생성 전까지만 로컬로 더한다 —
// 재생성 뒤 ClientErrorInput["kind"] 에 들어오면 이 합집합은 지운다.
export type ClientErrorKind = ClientErrorInput["kind"] | "push_subscribe";

export function safeHoondokPath(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0];
  if (/^\/hoondok\/words\/[^/]+\/?$/.test(path)) return "/hoondok/words/:volume";
  if (/^\/hoondok\/library\/[^/]+\/?$/.test(path)) return "/hoondok/library/:series";
  if (/^\/hoondok\/ask\/(?!log\/?$)[^/]+\/?$/.test(path)) return "/hoondok/ask/:id";
  if (/^\/hoondok\/worship\/challenge\/[^/]+\/?$/.test(path)) return "/hoondok/worship/challenge/:id";
  const allowed = [
    "/hoondok",
    "/hoondok/read",
    "/hoondok/library",
    "/hoondok/search",
    "/hoondok/ask",
    "/hoondok/ask/log",
    "/hoondok/garden",
    "/hoondok/settings",
    "/hoondok/onboarding",
    "/hoondok/offline",
    "/hoondok/worship",
    "/hoondok/worship/sermons",
    "/hoondok/worship/request",
    "/hoondok/family",
  ];
  return allowed.includes(path) ? path : "/hoondok";
}

export function reportClientError(kind: ClientErrorKind): void {
  if (typeof window === "undefined" || !/^\/hoondok(?:\/|$)/.test(window.location.pathname)) return;
  // 보고 요청은 관찰용 fetch 를 쓰지 않아 보고 실패가 다시 오류 보고를 만들지 않는다.
  void globalThis
    .fetch("/api/backend/hoondok/client-errors", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({ kind, path: safeHoondokPath(window.location.pathname) }),
    })
    .catch(() => {});
}

/** 훈독 API 어댑터만 주입한다. 공용 SDK 와 window.fetch 는 변경하지 않는다. */
export const hoondokFetch: typeof globalThis.fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  if (response.status >= 500) reportClientError("api_5xx");
  return response;
};
