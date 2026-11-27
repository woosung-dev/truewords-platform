import { describe, expect, it } from "vitest";
import { matchScore, searchByLabel } from "@/components/nav/menu-match";
import { findActiveNavItem, NAV_ITEMS } from "@/components/nav/nav-items";

describe("findActiveNavItem", () => {
  it("하위 경로에서는 가장 긴 메뉴가 활성이다", () => {
    expect(findActiveNavItem("/hoondok/cards")?.label).toBe("오늘의 책갈피");
    expect(findActiveNavItem("/hoondok/summaries/abc")?.label).toBe("말씀 AI 요약");
    expect(findActiveNavItem("/hoondok")?.label).toBe("훈독 편성");
    expect(findActiveNavItem("/hoondok/2026-11-27/edit")?.label).toBe("훈독 편성");
  });

  it("세그먼트 경계가 아닌 접두사는 맞추지 않는다", () => {
    expect(findActiveNavItem("/settings-old")).toBeUndefined();
    expect(findActiveNavItem("/login")).toBeUndefined();
  });
});

describe("메뉴 이름 검색", () => {
  it("띄어쓰기를 무시하고 정확 > 시작 > 포함 순으로 매긴다", () => {
    expect(matchScore("감사 로그", "감사로그")).toBe(100);
    expect(matchScore("감사 로그", "감사")).toBe(80);
    expect(matchScore("감사 로그", "로그")).toBe(60);
    expect(matchScore("감사 로그", "")).toBeNull();
  });

  it("초성과 조합 중인 글자로도 찾는다", () => {
    expect(matchScore("오늘의 책갈피", "ㅊㄱ")).not.toBeNull();
    expect(matchScore("피드백", "피드ㅂ")).not.toBeNull();
    expect(matchScore("설정", "ㄱㄴ")).toBeNull();
  });

  it("같은 등급이면 즐겨찾기를 먼저 둔다", () => {
    const plain = searchByLabel(NAV_ITEMS, "훈독").map((i) => i.label);
    expect(plain).toEqual(["훈독 편성", "훈독 권리"]);
    const starred = searchByLabel(NAV_ITEMS, "훈독", ["/hoondok/rights"]).map((i) => i.label);
    expect(starred).toEqual(["훈독 권리", "훈독 편성"]);
  });

  it("그룹 이름으로는 찾지 않는다(별칭 없음)", () => {
    expect(searchByLabel(NAV_ITEMS, "시스템")).toEqual([]);
  });
});
