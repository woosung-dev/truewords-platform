/**
 * 백엔드 에러 응답을 사용자 화면에 표시할 친절한 한국어 메시지로 변환.
 *
 * 회귀 방지: 이전에는 fetch error 메시지를 `오류: {raw JSON}` 으로 그대로 노출하여
 * ``error_code`` / ``request_id`` 가 사용자에게 보이는 결함이 있었다.
 * 이제는 ``ApiError.errorCode`` 별로 사람이 읽기 쉬운 안내 + 필요 시 추천 질문을
 * 제공한다 (2026-05-08 INPUT_BLOCKED / SEARCH_FAILED 운영 사례).
 */
import { ApiError } from "@/lib/api";

const FALLBACK_SUGGESTIONS: string[] = [
  "하나님을 왜 ‘하늘부모님’이라고 부르나요?",
  "참부모님의 위상과 가치는 왜 영원한가요?",
  "천일국 시대의 구원 조건은 무엇인가요?",
];

export interface FriendlyError {
  content: string;
  suggestedFollowups?: string[] | null;
  /** 같은 질문을 다시 보내면 나아질 수 있는 오류인지. 입력 차단·로그인 만료는 다시 보내도 같다. */
  retryable: boolean;
}

export function toFriendlyError(e: unknown): FriendlyError {
  if (e instanceof ApiError) {
    switch (e.errorCode) {
      case "INPUT_BLOCKED":
        return {
          content:
            "죄송합니다. 시스템 정책상 답변드리기 어려운 질문이에요. 아래 질문 중에서 골라보시거나 다른 방식으로 다시 여쭤봐주세요.",
          suggestedFollowups: FALLBACK_SUGGESTIONS,
          retryable: false,
        };
      case "RATE_LIMIT_EXCEEDED":
        return {
          content: "요청이 너무 많아요. 잠시 후 다시 시도해주세요.",
          retryable: true,
        };
      case "SEARCH_FAILED":
        return {
          content: "검색 서비스에 일시적 장애가 발생했어요. 잠시 후 다시 시도해주세요.",
          retryable: true,
        };
      case "EMBEDDING_FAILED":
        return {
          content: "검색 준비 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.",
          retryable: true,
        };
      case "UNAUTHORIZED":
        return { content: "다시 로그인이 필요해요.", retryable: false };
      case "INTERNAL_ERROR":
      default:
        return {
          content: "일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.",
          retryable: true,
        };
    }
  }
  return {
    content: "일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.",
    retryable: true,
  };
}
