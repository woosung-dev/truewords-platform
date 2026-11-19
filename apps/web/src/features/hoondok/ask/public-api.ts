import type {
  MyPublicQuestionItem,
  MyPublicQuestionListResponse,
  PublicQuestionBookmarkListResponse,
  PublicQuestionDetail,
  PublicQuestionListResponse,
} from "@truewords/api-client-ts/types";
import { hoondokRequest as request } from "../api-client";

// 공개 질문 (DEC-PWA-025). 목록·상세·조회 기록은 비로그인도 쓰고, 신청·내 목록·내리기·북마크는 훈독 로그인(`hoondok_token`)이 필요하다.
// 신청은 내 대화의 답(message_id)만 받는다 — 남의 대화·옛 익명 대화의 답은 404.
// 쓰기 요청의 X-Requested-With·credentials 는 SDK 전송층이 붙인다.
export const publicQuestionsAPI = {
  /** 협회가 공개한 질문 목록. 순서는 서버가 정한다(상단 고정 → 인기). 쪽을 넘기는 사이 순서가 바뀔 수 있어 화면이 id 로 중복을 거른다. */
  list: (query: { q?: string; cursor?: string | null } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.cursor) params.set("cursor", query.cursor);
    const suffix = params.size > 0 ? `?${params}` : "";
    return request<PublicQuestionListResponse>(`/hoondok/questions${suffix}`, { signal, cache: "no-store" });
  },
  detail: (id: string, signal?: AbortSignal) =>
    request<PublicQuestionDetail>(`/hoondok/questions/${encodeURIComponent(id)}`, { signal, cache: "no-store" }),
  /** 공개 상세 조회 1회 기록(204, 본문 없음). 로그인했으면 계정, 아니면 서버가 접속 정보로 익명 조회를 가린다 — 기기에 식별자를 두지 않는다. */
  recordView: (id: string) =>
    request<Record<string, never>>(`/hoondok/questions/${encodeURIComponent(id)}/views`, { method: "POST" }),
  /** 북마크(로그인 필요, 비로그인 401). 해제는 공개가 끝난 질문이어도 성공한다. */
  bookmark: (id: string) =>
    request<Record<string, never>>(`/hoondok/questions/${encodeURIComponent(id)}/bookmark`, { method: "PUT" }),
  unbookmark: (id: string) =>
    request<Record<string, never>>(`/hoondok/questions/${encodeURIComponent(id)}/bookmark`, { method: "DELETE" }),
  /** 내가 북마크한 공개 질문(최근 북마크 순, 공개 중인 것만). */
  bookmarks: (signal?: AbortSignal) =>
    request<PublicQuestionBookmarkListResponse>("/hoondok/me/question-bookmarks?limit=100", {
      signal,
      cache: "no-store",
    }),
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
