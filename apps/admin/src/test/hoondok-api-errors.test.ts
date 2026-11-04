import { describe, expect, it } from "vitest";
import { isNotFound, loadErrorMessage, mutationErrorMessage } from "@/features/hoondok/api-errors";
import { ApiError } from "@/lib/api";

describe("오류 문구", () => {
  it("변경 실패 — 404·401·403·422·기타", () => {
    expect(mutationErrorMessage(new ApiError(404, { message: "x" }), "f")).toBe(
      "이미 삭제된 항목이에요. 목록을 새로 고쳤어요",
    );
    expect(mutationErrorMessage(new ApiError(401, { message: "x" }), "f")).toContain("로그인");
    expect(mutationErrorMessage(new ApiError(403, { message: "x" }), "f")).toContain("권한");
    expect(mutationErrorMessage(new ApiError(422, { message: "x" }), "f")).toBe("입력값을 확인해 주세요");
    expect(mutationErrorMessage(new ApiError(500, { message: "x" }), "f")).toBe("f");
    expect(mutationErrorMessage(new Error("boom"), "f")).toBe("f");
  });

  it("조회 실패 — 403 은 권한 안내, 그 외는 fallback", () => {
    expect(loadErrorMessage(new ApiError(403, { message: "x" }), "f")).toBe("이 화면을 볼 권한이 없어요");
    expect(loadErrorMessage(new ApiError(401, { message: "x" }), "f")).toContain("로그인");
    expect(loadErrorMessage(new ApiError(500, { message: "x" }), "f")).toBe("f");
  });

  it("404 만 isNotFound", () => {
    expect(isNotFound(new ApiError(404, { message: "x" }))).toBe(true);
    expect(isNotFound(new ApiError(500, { message: "x" }))).toBe(false);
    expect(isNotFound(new Error("x"))).toBe(false);
  });
});
