import { describe, expect, it } from "vitest";
import { highlightSnippet, markSearchTerms } from "@/features/hoondok/library/search-highlight";

const hits = (text: string, query: string) =>
  highlightSnippet(text, query)
    .filter((part) => part.hit)
    .map((part) => part.text);

describe("검색 결과 하이라이트", () => {
  it("검색어가 나온 곳을 모두 표시한다", () => {
    expect(hits("탕감복귀를 해야 한다. 왜 탕감복귀인가", "탕감복귀")).toEqual(["탕감복귀", "탕감복귀"]);
  });

  it("구절의 따옴표는 빼고, 구절 전체를 낱말보다 먼저 찾는다", () => {
    expect(hits("참사랑은 직단거리를 갑니다. 참사랑은", '"참사랑은 직단거리를 갑니다"')).toEqual([
      "참사랑은 직단거리를 갑니다",
      "참사랑은",
    ]);
  });

  it("정규식 특수문자도 글자 그대로 찾는다", () => {
    expect(hits("(18-176, 67.6.4) 참고", "(18-176")).toEqual(["(18-176"]);
  });

  it("검색어가 없으면 원문 그대로 한 조각이다", () => {
    expect(highlightSnippet("정성을 드린다", "축복")).toEqual([{ text: "정성을 드린다", hit: false }]);
  });

  it("첫 일치가 뒤쪽이면 앞을 줄여 일치 근처부터 보인다", () => {
    const text = `${"가나다 ".repeat(40)}탕감복귀 이후`;
    const parts = highlightSnippet(text, "탕감복귀");
    expect(parts[0]).toEqual({ text: "…", hit: false });
    expect(parts.map((part) => part.text).join("").length).toBeLessThan(text.length);
    expect(hits(text, "탕감복귀")).toEqual(["탕감복귀"]);
  });

  it("원문 뷰용 표시는 앞을 자르지 않는다", () => {
    const text = `${"가나다 ".repeat(40)}탕감복귀 이후`;
    expect(markSearchTerms(text, "탕감복귀").map((part) => part.text).join("")).toBe(text);
  });
});
