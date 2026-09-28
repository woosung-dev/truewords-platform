import { describe, expect, it } from "vitest";
import { hasSearchHit, highlightSnippet, markSearchTerms } from "@/features/hoondok/library/search-highlight";

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
    expect(
      markSearchTerms(text, "탕감복귀")
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
  });
});

describe("검색어 일치 판정", () => {
  it("구절의 따옴표는 빼고 구절이나 낱말이 나오면 일치다", () => {
    expect(hasSearchHit("참사랑은 직단거리를 갑니다", '"참사랑은 직단거리를 갑니다"')).toBe(true);
    expect(hasSearchHit("직단거리로 가는 길", '"참사랑은 직단거리를 갑니다"')).toBe(false);
    expect(hasSearchHit("참사랑은 위하는 것", "참사랑은 어디로")).toBe(true);
  });

  it("한 글자 낱말만으로는 일치로 보지 않는다", () => {
    expect(hasSearchHit("길을 걷는다", "길 탕감")).toBe(false);
  });

  it("영문은 대소문자를 가리지 않는다", () => {
    expect(hasSearchHit("True Love 와 참사랑", "true love")).toBe(true);
  });

  it("빈 검색어는 일치가 아니다", () => {
    expect(hasSearchHit("정성을 드린다", '  ""  ')).toBe(false);
  });

  it("목록 밑줄과 같은 결과다", () => {
    for (const [text, query] of [
      ["탕감복귀를 해야 한다", "탕감복귀"],
      ["정성을 드린다", "축복"],
      ["길을 걷는다", "길 탕감"],
    ])
      expect(hasSearchHit(text, query)).toBe(highlightSnippet(text, query).some((part) => part.hit));
  });
});
