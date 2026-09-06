import { describe, expect, it } from "vitest";
import { toFriendlyError } from "@/features/chat/error-message";
import { ApiError } from "@/lib/api";

/**
 * 회귀 방지: 2026-05-08 운영에서 chat 페이지가 ``오류: {raw JSON ErrorResponse}``
 * 를 그대로 노출하던 결함. 이제 error_code 별 친절한 메시지로 분기되어야 한다.
 */
describe("toFriendlyError", () => {
  it("INPUT_BLOCKED 은 추천 질문 3개와 함께 친절한 안내를 제공한다", () => {
    const err = new ApiError(400, {
      error_code: "INPUT_BLOCKED",
      message: "허용되지 않는 입력 패턴이 감지되었습니다.",
      request_id: "req-123",
    });

    const result = toFriendlyError(err);

    expect(result.content).toContain("답변드리기 어려운");
    expect(result.suggestedFollowups).toHaveLength(3);
    // raw JSON 의 흔적이 화면에 노출되지 않아야 함
    expect(result.content).not.toContain("INPUT_BLOCKED");
    expect(result.content).not.toContain("request_id");
    expect(result.content).not.toContain("req-123");
  });

  it("RATE_LIMIT_EXCEEDED 는 잠시 후 재시도 안내", () => {
    const err = new ApiError(429, { error_code: "RATE_LIMIT_EXCEEDED" });
    const result = toFriendlyError(err);
    expect(result.content).toContain("잠시 후 다시");
    expect(result.suggestedFollowups).toBeUndefined();
  });

  it("SEARCH_FAILED 는 검색 장애 안내 (Qdrant 다운 시 노출)", () => {
    const err = new ApiError(503, {
      error_code: "SEARCH_FAILED",
      message: "검색 서비스 일시 장애",
    });
    const result = toFriendlyError(err);
    expect(result.content).toContain("검색");
    expect(result.content).toContain("잠시 후");
  });

  it("EMBEDDING_FAILED 도 사용자에게 검색 준비 오류로 노출", () => {
    const err = new ApiError(503, { error_code: "EMBEDDING_FAILED" });
    const result = toFriendlyError(err);
    expect(result.content).toContain("검색 준비");
  });

  it("UNAUTHORIZED 는 재로그인 안내", () => {
    const err = new ApiError(401, { error_code: "UNAUTHORIZED" });
    const result = toFriendlyError(err);
    expect(result.content).toContain("로그인");
  });

  it("INTERNAL_ERROR / 알 수 없는 코드는 일반 fallback", () => {
    const internal = new ApiError(500, { error_code: "INTERNAL_ERROR" });
    const unknown = new ApiError(500, { error_code: "WEIRD_NEW_CODE" });

    expect(toFriendlyError(internal).content).toContain("일시적");
    expect(toFriendlyError(unknown).content).toContain("일시적");
  });

  it("ApiError 가 아닌 일반 Error 도 fallback 으로 안전 처리", () => {
    const result = toFriendlyError(new Error("network broken"));
    expect(result.content).toContain("일시적");
    // 원본 메시지가 사용자에게 새지 않아야 함
    expect(result.content).not.toContain("network broken");
  });

  it("undefined / null 같은 비정상 입력도 fallback", () => {
    expect(toFriendlyError(undefined).content).toContain("일시적");
    expect(toFriendlyError(null).content).toContain("일시적");
  });
});
