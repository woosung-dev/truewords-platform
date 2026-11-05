import type {
  PublicQuestionAdminItem,
  PublicQuestionAdminListResponse,
  PublicQuestionReview,
} from "@truewords/api-client-ts/types";
import { fetchAPI } from "@/lib/api";

export type { PublicQuestionAdminItem, PublicQuestionAdminListResponse };
export type QuestionStatus = PublicQuestionAdminItem["status"];
export type QuestionReviewStatus = PublicQuestionReview["status"];
export type QuestionAnswerMode = PublicQuestionAdminItem["answer_mode"];

// 추천 질문 고르기 — 식구가 공개를 허용한 답(후보) 중 관리자가 고른 것만 추천 목록에 나간다.
export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  pending: "후보",
  published: "추천 중",
  hidden: "추천 안 함",
};

// 사용자 웹 훈독 질문 화면에서 보이는 답변 모델 이름과 맞춘다(관리자 분석 화면의 "신학자" 등과는 다르다).
export const ANSWER_MODE_LABEL: Record<QuestionAnswerMode, string> = {
  standard: "말씀 길잡이",
  theological: "깊은 해설",
  beginner: "처음 믿는 분",
  pastoral: "마음 돌봄",
  kids: "어린이",
};

export const QUESTION_PAGE_SIZE = 50;

const BASE = "/admin/hoondok/questions";

// 추천 질문 고르기 admin API. 신청자 정보는 응답에 없다. CSRF 헤더는 fetchAPI 가 붙인다.
export const questionsAPI = {
  /** 신청이 오래된 순으로 온다. */
  list: (status: QuestionStatus, page: number, pageSize = QUESTION_PAGE_SIZE) => {
    const params = new URLSearchParams({ status, page: String(page), page_size: String(pageSize) });
    return fetchAPI<PublicQuestionAdminListResponse>(`${BASE}?${params}`);
  },
  review: (id: string, status: QuestionReviewStatus) =>
    fetchAPI<PublicQuestionAdminItem>(`${BASE}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status } satisfies PublicQuestionReview),
    }),
};
