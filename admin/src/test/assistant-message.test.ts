// preprocess() 함수 회귀 테스트 — bullet 정규화 및 citation 치환 검증.
import { describe, it, expect } from "vitest";
import { preprocess } from "@/features/chat/components/assistant-message";

describe("preprocess - citation 치환", () => {
  it("[1] → [1](cite:1) 로 변환한다", () => {
    expect(preprocess("내용 [1].")).toBe("내용 [1](cite:1).");
  });

  it("이미 링크 형태인 [1](...) 는 변환하지 않는다", () => {
    expect(preprocess("[1](http://example.com)")).toBe("[1](http://example.com)");
  });

  it("[출처: ...] 라인을 제거한다", () => {
    expect(preprocess("답변 내용\n[출처: 원리강론]")).toBe("답변 내용");
  });
});

describe("preprocess - bullet 정규화", () => {
  it("인라인 bullet을 단락 구분으로 분리한다", () => {
    const input =
      "이유는 다음과 같습니다.\n\n• 항목1: 내용입니다. • 항목2: 내용입니다. • 항목3: 내용입니다.";
    const result = preprocess(input);
    expect(result).toContain("항목1: 내용입니다.\n\n• 항목2");
    expect(result).toContain("항목2: 내용입니다.\n\n• 항목3");
  });

  it("단일 개행만 있는 bullet도 이중개행으로 변환한다", () => {
    const input = "• 항목1: 내용\n• 항목2: 내용";
    const result = preprocess(input);
    expect(result).toBe("• 항목1: 내용\n\n• 항목2: 내용");
  });

  it("이미 이중개행인 bullet은 변경하지 않는다 (idempotent)", () => {
    const input = "• 항목1: 내용\n\n• 항목2: 내용";
    const result = preprocess(input);
    expect(result).toBe("• 항목1: 내용\n\n• 항목2: 내용");
  });

  it("줄 첫 번째 bullet(단독 단락)은 건드리지 않는다", () => {
    const input = "소개 문장입니다.\n\n• 단독 항목";
    const result = preprocess(input);
    expect(result).toBe("소개 문장입니다.\n\n• 단독 항목");
  });

  it("bullet 없는 일반 텍스트는 그대로 유지한다", () => {
    const input = "일반 텍스트입니다. 변경 없음.";
    const result = preprocess(input);
    expect(result).toBe("일반 텍스트입니다. 변경 없음.");
  });
});
