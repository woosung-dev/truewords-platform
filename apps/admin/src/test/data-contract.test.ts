import { describe, expect, it } from "vitest";
import { isPredictedOutcome } from "@/features/data-source/types";

describe("확장 가능한 업로드 결과 계약", () => {
  it("알려진 화면 집계 값만 허용한다", () => {
    for (const value of ["new", "merge", "replace", "skip"]) expect(isPredictedOutcome(value)).toBe(true);
  });

  it("미래 응답 값은 기존 버킷에 잘못 더하지 않는다", () => {
    expect(isPredictedOutcome("queued")).toBe(false);
    expect(isPredictedOutcome("")).toBe(false);
  });
});
