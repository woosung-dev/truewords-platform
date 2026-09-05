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

  it("multi-id [1, 2] 를 [1](cite:1)[2](cite:2) 로 분해한다", () => {
    expect(preprocess("내용입니다 [1, 2].")).toBe(
      "내용입니다 [1](cite:1)[2](cite:2).",
    );
  });

  it("공백 없는 multi-id [1,2,3] 도 분해한다", () => {
    expect(preprocess("출처 [1,2,3]")).toBe(
      "출처 [1](cite:1)[2](cite:2)[3](cite:3)",
    );
  });

  it("multi-id 와 single-id 가 혼재해도 모두 변환한다", () => {
    expect(preprocess("앞 [1] 뒤 [2, 4]")).toBe(
      "앞 [1](cite:1) 뒤 [2](cite:2)[4](cite:4)",
    );
  });
});

describe("preprocess - maxSourceN strip (sourceMap miss 방어)", () => {
  it("maxSourceN=3 일 때 [4] 는 빈 문자열로 strip", () => {
    expect(preprocess("내용 [4].", 3)).toBe("내용 .");
  });

  it("maxSourceN=3 일 때 [1] 은 그대로 변환", () => {
    expect(preprocess("내용 [1].", 3)).toBe("내용 [1](cite:1).");
  });

  it("multi-id [1, 5] 에서 maxSourceN=3 이면 [1] 만 남는다", () => {
    expect(preprocess("내용 [1, 5].", 3)).toBe("내용 [1](cite:1).");
  });

  it("multi-id [4, 5] 전부 초과면 빈 문자열", () => {
    expect(preprocess("내용 [4, 5].", 3)).toBe("내용 .");
  });

  it("multi-id [1, 2, 7] 에서 maxSourceN=3 이면 [1][2] 만 남는다", () => {
    expect(preprocess("내용 [1, 2, 7].", 3)).toBe(
      "내용 [1](cite:1)[2](cite:2).",
    );
  });

  it("default maxSourceN=Infinity 에서는 기존 동작 유지", () => {
    expect(preprocess("내용 [4].")).toBe("내용 [4](cite:4).");
  });
});

describe("preprocess - INLINE_CITATIONS 잔재 strip", () => {
  it("답변 끝의 INLINE_CITATIONS 블록을 본문에서 제거한다", () => {
    const input = `본문 결론입니다 [1].\n\nINLINE_CITATIONS:\n[1] "원문 인용 phrase"`;
    expect(preprocess(input)).toBe("본문 결론입니다 [1](cite:1).");
  });

  it("헤더가 누락된 채 phrase 라인만 끝에 leak 된 변형도 strip 한다", () => {
    const input = `본문 마무리.\n[1] "leaked phrase 1"\n[2] "leaked phrase 2"`;
    expect(preprocess(input)).toBe("본문 마무리.");
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
