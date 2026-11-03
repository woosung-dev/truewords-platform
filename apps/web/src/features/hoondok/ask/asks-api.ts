import type { AskQuota, MyAskDetail, MyAskListResponse } from "@truewords/api-client-ts/types";
import { hoondokRequest as request } from "../api-client";

// 내 AI 질문 (DEC-PWA-025 2차) — 질문·답·이어 묻기는 계정에만 보관한다(비공개 = 내 계정에서만). 모두 훈독 로그인 필요.
// 쓰기 요청의 X-Requested-With·credentials 는 SDK 전송층이 붙인다. 답 받기(SSE)는 ask-stream.ts 의 requestHoondokAsk.

/** React Query 키 접두. 로그아웃이 지우는 ["hoondok", …] 아래에 두되 ["hoondok","me"] 는 로그아웃이 남기므로 피한다. */
export const ASKS_KEY = ["hoondok", "asks"] as const;
export const ASK_LIST_KEY = [...ASKS_KEY, "list"] as const;
export const ASK_QUOTA_KEY = [...ASKS_KEY, "quota"] as const;
export const askDetailKey = (id: string) => [...ASKS_KEY, "detail", id] as const;

export const asksAPI = {
  /** 오늘(KST) 남은 질문 횟수. */
  quota: (signal?: AbortSignal) => request<AskQuota>("/hoondok/me/asks/quota", { signal, cache: "no-store" }),
  /** 최근 답 순, 최대 100건. */
  list: (signal?: AbortSignal) =>
    request<MyAskListResponse>("/hoondok/me/asks?limit=100", { signal, cache: "no-store" }),
  detail: (id: string, signal?: AbortSignal) =>
    request<MyAskDetail>(`/hoondok/me/asks/${encodeURIComponent(id)}`, { signal, cache: "no-store" }),
  setSaved: (id: string, saved: boolean) =>
    request<MyAskDetail>(`/hoondok/me/asks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ saved }),
    }),
};

/** 질문 화면 상세 주소의 대화 id 가 서버 대화(session_id, UUID)인지. 아니면 아직 답을 받는 중인 임시 id 다. */
export function isSessionId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
