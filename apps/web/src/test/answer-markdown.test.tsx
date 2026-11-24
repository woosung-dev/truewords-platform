import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnswerMarkdown } from "@/features/hoondok/ask/components/answer-markdown";

describe("AI 답 본문 렌더러", () => {
  it("모델 답의 마크다운 이미지는 그리지 않는다", () => {
    const { container } = render(<AnswerMarkdown answer={"설명\n\n![a](https://attacker.invalid/p.png)"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("설명");
  });

  it("링크는 글자로만 남긴다", () => {
    const { container } = render(<AnswerMarkdown answer={"[여기](https://attacker.invalid/)"} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("여기");
  });
});
