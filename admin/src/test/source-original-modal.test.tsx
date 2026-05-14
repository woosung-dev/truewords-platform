// 원문 모달의 본문 톤 분리 회귀 테스트.
// 형광 highlight 는 종교 도메인 묵상 톤을 위해 폐기됨 (2026-05-14).
// main 청크 = 기본 색, before/after = muted 색의 3톤 구분만 검증.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderBody3Tone } from "@/components/truewords/source-original-modal";

function renderToDom(node: React.ReactNode) {
  const utils = render(<p>{node}</p>);
  const muted = utils.container.querySelectorAll("span.text-muted-foreground");
  return { ...utils, muted };
}

describe("renderBody3Tone — main/before/after 색 톤 분리", () => {
  it("main 외부 (before + after) 만 muted 처리", () => {
    const body = "AAAABBBBCCCC";
    const { container, muted } = renderToDom(renderBody3Tone(body, 4, 8));

    expect(container.textContent).toBe(body);
    expect(muted.length).toBe(2);
    expect(muted[0].textContent).toBe("AAAA");
    expect(muted[1].textContent).toBe("CCCC");
  });

  it("merged_text 가 비어있는 단일 청크 fallback — muted 0개 (전체가 main)", () => {
    const body = "전체본문이메인";
    const { container, muted } = renderToDom(
      renderBody3Tone(body, 0, body.length),
    );

    expect(container.textContent).toBe(body);
    expect(muted.length).toBe(0);
  });

  it("main 이 본문 시작에 있는 케이스 — after 만 muted", () => {
    const body = "MAIN후기내용";
    const { container, muted } = renderToDom(renderBody3Tone(body, 0, 4));

    expect(container.textContent).toBe(body);
    expect(muted.length).toBe(1);
    expect(muted[0].textContent).toBe("후기내용");
  });

  it("main 이 본문 끝에 있는 케이스 — before 만 muted", () => {
    const body = "전기내용MAIN";
    const { container, muted } = renderToDom(renderBody3Tone(body, 4, 8));

    expect(container.textContent).toBe(body);
    expect(muted.length).toBe(1);
    expect(muted[0].textContent).toBe("전기내용");
  });

  it("범위 over flow 안전 처리 — body 길이로 clamp", () => {
    const body = "AAAA";
    const { container, muted } = renderToDom(renderBody3Tone(body, -10, 100));

    expect(container.textContent).toBe(body);
    // 음수 mainStart → safeStart=0, 100 → safeEnd=4. before/after 둘 다 빈 문자열.
    expect(muted.length).toBe(0);
  });

  it("mainStart > mainEnd 비정상 입력 — safeEnd 가 safeStart 로 clamp", () => {
    const body = "AAAABBBB";
    const { container, muted } = renderToDom(renderBody3Tone(body, 5, 3));

    expect(container.textContent).toBe(body);
    // safeStart=5, safeEnd=max(5, 3)=5 → main 빈 문자열, before=AAAAB, after=BBB.
    expect(muted.length).toBe(2);
    expect(muted[0].textContent).toBe("AAAAB");
    expect(muted[1].textContent).toBe("BBB");
  });

  it("형광 mark 요소는 0개 (highlight 폐기 회귀)", () => {
    const body = "AAAABBBBCCCC";
    const { container } = renderToDom(renderBody3Tone(body, 4, 8));

    expect(container.querySelectorAll("mark").length).toBe(0);
  });
});
