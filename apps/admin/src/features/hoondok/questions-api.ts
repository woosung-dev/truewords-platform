import type {
  PublicQuestionAdminItem,
  PublicQuestionAdminListResponse,
  PublicQuestionPinsReorder,
  PublicQuestionPinsResponse,
  PublicQuestionReview,
} from "@truewords/api-client-ts/types";
import { fetchAPI } from "@/lib/api";

export type { PublicQuestionAdminItem, PublicQuestionAdminListResponse, PublicQuestionPinsResponse };
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
/** 상단 고정 최대 개수(서버 한도와 같다). */
export const MAX_PINNED = 10;
/** 검색어 최대 길이(서버 한도와 같다). */
export const QUESTION_SEARCH_MAX = 100;

export type QuestionSort = "oldest" | "newest" | "popular";
export const QUESTION_SORT_LABEL: Record<QuestionSort, string> = {
  oldest: "오래된 신청순",
  newest: "최신 신청순",
  popular: "인기순",
};

export interface QuestionListParams {
  status: QuestionStatus;
  sort?: QuestionSort;
  q?: string;
  page: number;
  pageSize?: number;
}

/** 상태·고정 변경 본문(둘 중 하나 이상). */
export type QuestionPatch = PublicQuestionReview;

const BASE = "/admin/hoondok/questions";

// 추천 질문 고르기 admin API. 신청자 정보는 응답에 없다. CSRF 헤더는 fetchAPI 가 붙인다.
export const questionsAPI = {
  /** 기본 정렬은 신청이 오래된 순이다. 검색어가 비면 q 를 보내지 않는다. */
  list: ({ status, sort = "oldest", q = "", page, pageSize = QUESTION_PAGE_SIZE }: QuestionListParams) => {
    const params = new URLSearchParams({ status, sort, page: String(page), page_size: String(pageSize) });
    const term = q.trim();
    if (term) params.set("q", term);
    return fetchAPI<PublicQuestionAdminListResponse>(`${BASE}?${params}`);
  },
  /** 고정 목록 — 고정 순서대로 온다. */
  pins: () => fetchAPI<PublicQuestionPinsResponse>(`${BASE}/pins`),
  /** 현재 고정된 질문 전체를 새 순서로 보낸다(집합이 다르면 422). */
  reorderPins: (ids: string[]) =>
    fetchAPI<PublicQuestionPinsResponse>(`${BASE}/pins`, {
      method: "PUT",
      body: JSON.stringify({ ids } satisfies PublicQuestionPinsReorder),
    }),
  update: (id: string, patch: QuestionPatch) =>
    fetchAPI<PublicQuestionAdminItem>(`${BASE}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  review: (id: string, status: QuestionReviewStatus) => questionsAPI.update(id, { status }),
};
