// 원문 모달의 인용 강조 매칭 회귀 테스트.
// dedup 으로 main 슬라이스 < snippet 인 케이스 (운영에서 다수 발생) 가 핵심 시나리오.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  findFlexibleMatch,
  renderBodyWithHighlight,
} from "@/components/truewords/source-original-modal";

function renderToDom(node: React.ReactNode) {
  const utils = render(<p>{node}</p>);
  const marks = utils.container.querySelectorAll("mark.tw-highlight");
  return { ...utils, marks };
}

describe("findFlexibleMatch", () => {
  it("정확 substring 을 우선 매칭한다", () => {
    // "앞부분 인용된 본문 뒷부분" 의 "인용된 본문" 은 [4, 10).
    expect(findFlexibleMatch("앞부분 인용된 본문 뒷부분", "인용된 본문")).toEqual([
      4,
      10,
    ]);
  });

  it("snippet 이 비어있으면 null 반환", () => {
    expect(findFlexibleMatch("any text", "")).toBeNull();
    expect(findFlexibleMatch("any text", "   ")).toBeNull();
  });

  it("공백/줄바꿈 차이를 \\s+ 로 완화 매칭한다", () => {
    const text = "앞 인용된\n  본문 이어짐";
    const snippet = "인용된 본문";
    const range = findFlexibleMatch(text, snippet);
    expect(range).not.toBeNull();
    expect(text.slice(range![0], range![1])).toBe("인용된\n  본문");
  });

  it("매칭 실패 시 null 반환", () => {
    expect(findFlexibleMatch("앞 본문 뒷부분", "전혀 다른 텍스트")).toBeNull();
  });

  it("정규식 특수문자가 포함된 snippet 도 안전하게 처리한다", () => {
    const text = "본문 (괄호) 처리 가능";
    // "(괄호)" 시작 3, 끝 7 (exclusive).
    expect(findFlexibleMatch(text, "(괄호)")).toEqual([3, 7]);
  });
});

describe("renderBodyWithHighlight", () => {
  it("snippet 없으면 mark 미생성 — main/muted 만 분리", () => {
    const body = "AAAABBBBCCCC";
    const { marks, container } = renderToDom(
      renderBodyWithHighlight(body, 4, 8, undefined),
    );
    expect(marks.length).toBe(0);
    expect(container.textContent).toBe(body);
    const muted = container.querySelectorAll("span.text-muted-foreground");
    expect(muted.length).toBe(2);
    expect(muted[0].textContent).toBe("AAAA");
    expect(muted[1].textContent).toBe("CCCC");
  });

  it("snippet 이 main 슬라이스 안에 정확 매칭 — mark 1개", () => {
    const body = "before|MAIN_BODY|after";
    const mainStart = 7;
    const mainEnd = 16;
    const { marks } = renderToDom(
      renderBodyWithHighlight(body, mainStart, mainEnd, "MAIN_BODY"),
    );
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("MAIN_BODY");
  });

  it("snippet 이 main 외부 (인접 컨텍스트) 에 매칭 — mark 1개", () => {
    const body = "BEFORE_HIT|MAIN|after";
    const { marks } = renderToDom(
      renderBodyWithHighlight(body, 11, 15, "BEFORE_HIT"),
    );
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("BEFORE_HIT");
  });

  it("snippet 이 main 경계를 가로질러 매칭 — mark 가 main + 인접 양쪽에 걸침", () => {
    const body = "AAAABBBBCCCC";
    // mainStart=4, mainEnd=8 → main = "BBBB"
    // snippet "AABBBBCC" 는 mainStart 이전부터 mainEnd 이후까지 걸침.
    const { marks } = renderToDom(
      renderBodyWithHighlight(body, 4, 8, "AABBBBCC"),
    );
    // 매칭 영역이 main 경계와 만나서 segment 가 분리되어 mark 가 여러 개로 나뉠 수 있음.
    // 핵심: 모든 mark 의 textContent 합이 snippet 과 같아야 함.
    const joined = Array.from(marks)
      .map((m) => m.textContent)
      .join("");
    expect(joined).toBe("AABBBBCC");
    expect(marks.length).toBeGreaterThanOrEqual(1);
  });

  it("snippet 매칭 실패 — mark 0개 (이전 동작 유지)", () => {
    const body = "before|MAIN|after";
    const { marks, container } = renderToDom(
      renderBodyWithHighlight(body, 7, 11, "전혀 없는 문장"),
    );
    expect(marks.length).toBe(0);
    expect(container.textContent).toBe(body);
  });

  // ★ 핵심 회귀 케이스: 실제 운영에서 측정된 dedup 시나리오 재현.
  // text=695, main_len=590 (overlap 105) → 기존 로직은 mark 0, 신규 로직은 mark 1+.
  it("dedup 시나리오 (text > main, snippet 이 main 밖부터 시작) — mark 생성", () => {
    // body = [105자 prev_overlap_dedup_remainder] + [main 590자] + [tail]
    const prev = "P".repeat(105);
    const main = "M".repeat(590);
    const tail = "T".repeat(200);
    const body = prev + main + tail;
    const mainStart = 105;
    const mainEnd = 695;
    // snippet = src.text 전체 (695자) — prev 마지막 105자 + main 590자.
    const snippet = body.slice(0, 695);

    const { marks } = renderToDom(
      renderBodyWithHighlight(body, mainStart, mainEnd, snippet),
    );
    expect(marks.length).toBeGreaterThanOrEqual(1);
    const joined = Array.from(marks)
      .map((m) => m.textContent)
      .join("");
    expect(joined.length).toBe(695);
  });

  it("merged_text 가 비어있는 단일 청크 fallback — mainStart=0, mainEnd=text.length", () => {
    const body = "전체본문이메인";
    const { marks, container } = renderToDom(
      renderBodyWithHighlight(body, 0, body.length, "본문"),
    );
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("본문");
    // muted 영역 없음 (전체가 main)
    const muted = container.querySelectorAll("span.text-muted-foreground");
    expect(muted.length).toBe(0);
  });
});
