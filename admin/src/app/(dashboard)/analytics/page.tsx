"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { analyticsAPI } from "@/features/analytics/api";
import type { SearchStats, DailyCount, TopQuery } from "@/features/analytics/types";
import { Skeleton } from "@/components/ui/skeleton";
import QueryDetailModal from "@/features/analytics/components/query-detail-modal";

// ─────────────────────────────────────────────
// StatCard (inline, 카드 컴포넌트 미사용 패턴 유지)
// ─────────────────────────────────────────────
function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | number;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <p className="text-3xl font-bold tracking-tight">{value}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Fallback 분포 — CSS 수평 바
// ─────────────────────────────────────────────
function FallbackDistribution({ stats, loading }: { stats?: SearchStats; loading: boolean }) {
  const total = stats
    ? stats.fallback_none + stats.fallback_relaxed + stats.fallback_suggestions
    : 0;

  const rows: { label: string; key: keyof Pick<SearchStats, "fallback_none" | "fallback_relaxed" | "fallback_suggestions"> }[] = [
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
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
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
  onSelect,
}: {
  queries?: TopQuery[];
  loading: boolean;
  onSelect: (queryText: string) => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">인기 질문 Top 10</h2>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !queries || queries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          인기 질문이 없습니다
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground w-10">
                  순위
                </th>
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">
                  질문
                </th>
                <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-16">
                  횟수
                </th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q, i) => (
                <tr
                  key={i}
                  className={
                    (i !== 0 ? "border-t " : "") +
                    "cursor-pointer hover:bg-muted/40 transition-colors"
                  }
                  onClick={() => onSelect(q.query_text)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(q.query_text);
                    }
                  }}
                  title="클릭하면 상세 정보를 확인할 수 있습니다"
                >
                  <td className="py-2 px-3 text-muted-foreground font-mono text-xs">
                    {i + 1}
                  </td>
                  <td className="py-2 px-3 truncate max-w-0 w-full">
                    <span className="block truncate" title={q.query_text}>
                      {q.query_text}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-medium">
                    {q.count.toLocaleString()}
                  </td>
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

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["search-stats"],
    queryFn: () => analyticsAPI.getSearchStats(30),
  });

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ["daily-trend"],
    queryFn: () => analyticsAPI.getDailyTrend(30),
  });

  const { data: topQueries, isLoading: topQueriesLoading } = useQuery({
    queryKey: ["top-queries"],
    queryFn: () => analyticsAPI.getTopQueries(30, 10),
  });

  // 차트용 날짜 포맷 (MM/DD)
  const chartData: DailyCount[] = (trend ?? []).map((d) => ({
    ...d,
    date: d.date.slice(5), // "2026-04-11" → "04/11"
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">검색 분석</h1>
        <p className="text-sm text-muted-foreground mt-1">
          검색 파이프라인 성능을 분석합니다
        </p>
      </div>

      {/* 통계 카드 4개 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="총 검색 수"
          value={(stats?.total_searches ?? 0).toLocaleString()}
          loading={statsLoading}
        />
        <StatCard
          label="쿼리 재작성률"
          value={
            stats
              ? `${(stats.rewrite_rate * 100).toFixed(1)}%`
              : "0%"
          }
          loading={statsLoading}
        />
        <StatCard
          label="결과 없음 비율"
          value={
            stats
              ? `${(stats.zero_result_rate * 100).toFixed(1)}%`
              : "0%"
          }
          loading={statsLoading}
        />
        <StatCard
          label="평균 지연 시간"
          value={
            stats
              ? `${Math.round(stats.avg_latency_ms).toLocaleString()} ms`
              : "0 ms"
          }
          loading={statsLoading}
        />
      </div>

      {/* 일별 트렌드 차트 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">일별 검색량 (최근 30일)</h2>
        {trendLoading ? (
          <Skeleton className="h-52 w-full" />
        ) : chartData.length === 0 ? (
          <div className="h-52 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">데이터가 없습니다</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={208}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--foreground)",
                }}
                cursor={{ fill: "var(--muted)" }}
              />
              <Bar
                dataKey="count"
                name="검색 수"
                fill="var(--primary)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 하단 2열 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FallbackDistribution stats={stats} loading={statsLoading} />
        <TopQueriesTable
          queries={topQueries}
          loading={topQueriesLoading}
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
