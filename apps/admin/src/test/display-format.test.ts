import { describe, expect, it } from "vitest";
import { findActiveNavItem } from "@/app/(dashboard)/nav-items";
import { dailyTrendSummary, searchKpis } from "@/features/analytics/format";
import type { SearchStats } from "@/features/analytics/types";
import { formatPageRange, formatShortDate } from "@/lib/utils";

function stats(overrides: Partial<SearchStats> = {}): SearchStats {
  return {
    total_searches: 40,
    rewrite_rate: 0.25,
    zero_result_rate: 0.05,
    avg_latency_ms: 1234.4,
    fallback_none: 30,
    fallback_relaxed: 8,
    fallback_suggestions: 2,
    ...overrides,
  };
}

describe("formatPageRange", () => {
  it("빈 페이지를 1–0건으로 보이지 않는다", () => {
    expect(formatPageRange(0, 0)).toBe("0건");
    expect(formatPageRange(20, 0)).toBe("0건");
  });

  it("보이는 행의 범위를 쓴다", () => {
    expect(formatPageRange(0, 20)).toBe("1–20건");
    expect(formatPageRange(20, 3)).toBe("21–23건");
  });
});

describe("formatShortDate", () => {
  it("API 날짜를 월/일로 줄인다", () => {
    expect(formatShortDate("2026-04-11")).toBe("4/11");
    expect(formatShortDate("2026-10-05")).toBe("10/5");
  });

  it("모르는 형식은 그대로 둔다", () => {
    expect(formatShortDate("오늘")).toBe("오늘");
  });
});

describe("searchKpis", () => {
  it("불러오지 못하면 모든 값을 0 이 아닌 —로 둔다", () => {
    expect(searchKpis(undefined, true)).toEqual({
      totalSearches: "—",
      rewriteRate: "—",
      zeroResultRate: "—",
      avgLatency: "—",
    });
    // 이전 응답이 남아 있어도 오류면 숫자를 보이지 않는다.
    expect(searchKpis(stats(), true).totalSearches).toBe("—");
  });

  it("검색 0건이면 검색 수만 0 이고 비율·평균은 계산하지 않는다", () => {
    expect(
      searchKpis(stats({ total_searches: 0, rewrite_rate: 0, zero_result_rate: 0, avg_latency_ms: 0 }), false),
    ).toEqual({ totalSearches: "0", rewriteRate: "—", zeroResultRate: "—", avgLatency: "—" });
  });

  it("값이 있으면 비율·지연을 형식에 맞춘다", () => {
    expect(searchKpis(stats(), false)).toEqual({
      totalSearches: "40",
      rewriteRate: "25.0%",
      zeroResultRate: "5.0%",
      avgLatency: "1,234 ms",
    });
  });
});

describe("dailyTrendSummary", () => {
  it("합계와 가장 많은 날을 말한다", () => {
    const rows = [
      { date: "2026-10-03", count: 2 },
      { date: "2026-10-04", count: 7 },
      { date: "2026-10-05", count: 1 },
    ];
    expect(dailyTrendSummary(rows, formatShortDate)).toBe("최근 30일 일별 검색량: 합계 10건, 가장 많은 날 10/4 7건");
  });

  it("모두 0이면 가장 많은 날을 말하지 않는다", () => {
    expect(dailyTrendSummary([{ date: "2026-10-05", count: 0 }], formatShortDate)).toBe(
      "최근 30일 일별 검색량: 합계 0건",
    );
  });
});

describe("findActiveNavItem", () => {
  it("훈독 하위 화면은 훈독 편성이 아니라 자기 메뉴를 고른다", () => {
    expect(findActiveNavItem("/hoondok/rights")?.label).toBe("훈독 권리");
    expect(findActiveNavItem("/hoondok/cards")?.label).toBe("오늘의 책갈피");
  });

  it("편성 상세·새 편성은 훈독 편성에 속한다", () => {
    expect(findActiveNavItem("/hoondok")?.label).toBe("훈독 편성");
    expect(findActiveNavItem("/hoondok/new")?.label).toBe("훈독 편성");
    expect(findActiveNavItem("/hoondok/abc/edit")?.label).toBe("훈독 편성");
  });

  it("경로 앞부분만 같은 다른 메뉴에 걸리지 않는다", () => {
    expect(findActiveNavItem("/analytics/queries")?.label).toBe("검색 분석");
    expect(findActiveNavItem("/chatbots-archive")).toBeUndefined();
  });
});
