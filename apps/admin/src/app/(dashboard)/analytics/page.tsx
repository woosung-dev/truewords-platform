"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LoadError } from "@/components/load-error";
import { METRIC_ERROR, MetricBand } from "@/components/metric-band";
import { Skeleton } from "@/components/ui/skeleton";
import { analyticsAPI } from "@/features/analytics/api";
import { ModesChart } from "@/features/analytics/components/modes-chart";
import QueryDetailModal from "@/features/analytics/components/query-detail-modal";
import { TruncateTooltip } from "@/features/analytics/components/truncate-tooltip";
import { dailyTrendSummary, searchKpis } from "@/features/analytics/format";
import type { SearchStats, TopQuery } from "@/features/analytics/types";
import { formatShortDate } from "@/lib/utils";

// 빈 상태·오류 문구 — 차트 높이를 비워 두지 않고 한 줄로 말한다.
const NO_SEARCHES = "최근 30일 동안 검색이 없어요. 사용자 웹에서 질문이 들어오면 날짜별로 쌓여요.";
const LOAD_FAILED = "불러오지 못했어요.";

// ─────────────────────────────────────────────
// Fallback 분포 — CSS 수평 바
// ─────────────────────────────────────────────
function FallbackDistribution({ stats, loading, error }: { stats?: SearchStats; loading: boolean; error: boolean }) {
  const total = stats ? stats.fallback_none + stats.fallback_relaxed + stats.fallback_suggestions : 0;

  const rows: {
    label: string;
    key: keyof Pick<SearchStats, "fallback_none" | "fallback_relaxed" | "fallback_suggestions">;
  }[] = [
    { label: "정상", key: "fallback_none" },
    { label: "완화 검색", key: "fallback_relaxed" },
    { label: "질문 제안", key: "fallback_suggestions" },
  ];

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">Fallback 분포</h2>
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-muted-foreground">{LOAD_FAILED}</p>
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground">최근 30일 동안 검색이 없어요.</p>
      ) : (
        <div className="space-y-3">
          {rows.map(({ label, key }) => {
            const count = stats?.[key] ?? 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">
                    {count.toLocaleString()}
                    <span className="text-muted-foreground ml-1">({pct}%)</span>
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-admin-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Top 10 쿼리 테이블
// ─────────────────────────────────────────────
function TopQueriesTable({
  queries,
  loading,
  error,
  onSelect,
}: {
  queries?: TopQuery[];
  loading: boolean;
  error: boolean;
  onSelect: (queryText: string) => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">인기 질문 Top 10</h2>
        <Link href="/analytics/queries" className="text-xs text-primary hover:underline">
          모두 보기 →
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-muted-foreground">{LOAD_FAILED}</p>
      ) : !queries || queries.length === 0 ? (
        <p className="text-sm text-muted-foreground">최근 30일 동안 질문이 없어요.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-admin-muted/50 border-b">
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground w-10">순위</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">질문</th>
                <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-16">횟수</th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q, i) => (
                // 행 어디를 눌러도 열리고, 키보드는 질문 칸의 버튼으로 연다(표 시맨틱 유지).
                <tr
                  key={i}
                  className={(i !== 0 ? "border-t " : "") + "cursor-pointer hover:bg-admin-muted/40 transition-colors"}
                  onClick={() => onSelect(q.query_text)}
                >
                  <td className="py-2 px-3 text-muted-foreground font-mono text-xs">{i + 1}</td>
                  <td className="py-2 px-3 max-w-0 w-full">
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(q.query_text);
                      }}
                    >
                      <TruncateTooltip text={q.query_text} />
                    </button>
                  </td>
                  <td className="py-2 px-3 text-right font-medium">{q.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────
export default function AnalyticsPage() {
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);

  const statsQuery = useQuery({
    queryKey: ["search-stats"],
    queryFn: () => analyticsAPI.getSearchStats(30),
  });

  const trendQuery = useQuery({
    queryKey: ["daily-trend"],
    queryFn: () => analyticsAPI.getDailyTrend(30),
  });

  const topQueriesQuery = useQuery({
    queryKey: ["top-queries"],
    queryFn: () => analyticsAPI.getTopQueries(30, 10),
  });

  const dailyModesQuery = useQuery({
    queryKey: ["daily-modes"],
    queryFn: () => analyticsAPI.getDailyModes(30),
  });

  const failedQueries = [statsQuery, trendQuery, topQueriesQuery, dailyModesQuery].filter((q) => q.isError);
  const kpis = searchKpis(statsQuery.data, statsQuery.isError);
  const statsLoading = statsQuery.isLoading;
  const trend = trendQuery.data ?? [];
  const errorHint = statsQuery.isError ? METRIC_ERROR.hint : undefined;
  const rateHint = errorHint ?? (statsQuery.data?.total_searches === 0 ? "검색 없음" : undefined);

  return (
    <div className="space-y-6 page-wide">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">검색 분석</h1>
        <p className="text-sm text-muted-foreground mt-1">최근 30일</p>
      </div>

      {failedQueries.length > 0 && (
        <LoadError
          message="일부 지표를 불러오지 못했습니다."
          onRetry={() => {
            for (const q of failedQueries) q.refetch();
          }}
        />
      )}

      <MetricBand
        metrics={[
          { label: "총 검색 수", value: kpis.totalSearches, hint: errorHint, loading: statsLoading },
          { label: "쿼리 재작성률", value: kpis.rewriteRate, hint: rateHint, loading: statsLoading },
          { label: "결과 없음 비율", value: kpis.zeroResultRate, hint: rateHint, loading: statsLoading },
          { label: "평균 지연 시간", value: kpis.avgLatency, hint: rateHint, loading: statsLoading },
        ]}
      />

      {/* 일별 트렌드 차트 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">일별 검색량 (최근 30일)</h2>
        {trendQuery.isLoading ? (
          <Skeleton className="h-52 w-full" />
        ) : trendQuery.isError ? (
          <p className="text-sm text-muted-foreground">{LOAD_FAILED}</p>
        ) : trend.length === 0 ? (
          <p className="text-sm text-muted-foreground">{NO_SEARCHES}</p>
        ) : (
          <div role="img" aria-label={dailyTrendSummary(trend, formatShortDate)}>
            <ResponsiveContainer width="100%" height={208}>
              <BarChart data={trend} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  labelFormatter={(label) => formatShortDate(String(label))}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--foreground)",
                  }}
                  cursor={{ fill: "var(--muted)" }}
                />
                <Bar dataKey="count" name="검색 수" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* BL-6 — 일별 모드 분포 차트 (4주 시범 운영 baseline) */}
      <ModesChart rows={dailyModesQuery.data} loading={dailyModesQuery.isLoading} error={dailyModesQuery.isError} />

      {/* 하단 2열 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FallbackDistribution stats={statsQuery.data} loading={statsLoading} error={statsQuery.isError} />
        <TopQueriesTable
          queries={topQueriesQuery.data}
          loading={topQueriesQuery.isLoading}
          error={topQueriesQuery.isError}
          onSelect={(q) => setSelectedQuery(q)}
        />
      </div>

      <QueryDetailModal
        open={selectedQuery !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedQuery(null);
        }}
        queryText={selectedQuery}
        days={30}
      />
    </div>
  );
}
