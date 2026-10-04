import type { DailyCount, SearchStats } from "./types";

export interface SearchKpis {
  totalSearches: string;
  rewriteRate: string;
  zeroResultRate: string;
  avgLatency: string;
}

const EMPTY = "—";

/**
 * 검색 분석 KPI 표시값. 불러오지 못했으면 전부 "—"(0 으로 위장하지 않는다).
 * 검색이 0건이면 비율·평균은 계산할 수 없으니 "—"이고, 검색 수만 0 이다.
 */
export function searchKpis(stats: SearchStats | undefined, isError: boolean): SearchKpis {
  if (isError || !stats) {
    return { totalSearches: EMPTY, rewriteRate: EMPTY, zeroResultRate: EMPTY, avgLatency: EMPTY };
  }
  if (stats.total_searches === 0) {
    return { totalSearches: "0", rewriteRate: EMPTY, zeroResultRate: EMPTY, avgLatency: EMPTY };
  }
  return {
    totalSearches: stats.total_searches.toLocaleString(),
    rewriteRate: `${(stats.rewrite_rate * 100).toFixed(1)}%`,
    zeroResultRate: `${(stats.zero_result_rate * 100).toFixed(1)}%`,
    avgLatency: `${Math.round(stats.avg_latency_ms).toLocaleString()} ms`,
  };
}

/** 차트를 못 보는 사용자를 위한 한 줄 요약. 합계와 가장 많은 날을 말한다. */
export function dailyTrendSummary(rows: DailyCount[], formatDate: (iso: string) => string): string {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const peak = rows.reduce<DailyCount | null>(
    (best, row) => (best === null || row.count > best.count ? row : best),
    null,
  );
  const peakText = peak && peak.count > 0 ? `, 가장 많은 날 ${formatDate(peak.date)} ${peak.count}건` : "";
  return `최근 30일 일별 검색량: 합계 ${total.toLocaleString()}건${peakText}`;
}
