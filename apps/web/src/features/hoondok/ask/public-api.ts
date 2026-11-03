import type {
  MyPublicQuestionItem,
  MyPublicQuestionListResponse,
  PublicQuestionDetail,
  PublicQuestionListResponse,
} from "@truewords/api-client-ts/types";
import { hoondokRequest as request } from "../api-client";

// 공개 질문 (DEC-PWA-025). 목록·상세는 비로그인 열람, 신청·내 목록·내리기는 훈독 로그인(`hoondok_token`)이 필요하다.
// 신청은 내 대화의 답(message_id)만 받는다 — 남의 대화·옛 익명 대화의 답은 404.
// 쓰기 요청의 X-Requested-With·credentials 는 SDK 전송층이 붙인다.
export const publicQuestionsAPI = {
  /** 협회가 공개한 질문 목록(공개 시각 최신순). q 는 질문 문장 부분 일치. */
  list: (query: { q?: string; cursor?: string | null } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.cursor) params.set("cursor", query.cursor);
    const suffix = params.size > 0 ? `?${params}` : "";
    return request<PublicQuestionListResponse>(`/hoondok/questions${suffix}`, { signal, cache: "no-store" });
  },
  detail: (id: string, signal?: AbortSignal) =>
    request<PublicQuestionDetail>(`/hoondok/questions/${encodeURIComponent(id)}`, { signal, cache: "no-store" }),
  /** 서버는 질문·답을 자기 기록에서 복사한다 — 클라이언트는 message_id 만 보낸다. */
  submit: (messageId: string) =>
    request<MyPublicQuestionItem>("/hoondok/me/questions", {
      method: "POST",
      body: JSON.stringify({ message_id: messageId }),
    }),
  mine: () => request<MyPublicQuestionListResponse>("/hoondok/me/questions", { cache: "no-store" }),
  remove: (id: string) =>
    request<Record<string, never>>(`/hoondok/me/questions/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/** 공개 상태 배지 문구. 추천 질문 = 식구가 공개를 허용한 답 중 관리자가 고른 것(DEC-PWA-025 2차). 없으면 비공개. */
export const PUBLIC_STATUS_LABEL = {
  pending: "공개 허용",
  published: "추천 질문",
  hidden: "추천 안 함",
} as const;
