// 일별 검색량 막대 차트 — analytics/page.tsx 의 차트 영역 분리.
// next/dynamic 으로 lazy load 해 recharts 번들이 entry chunk 에 들어가지 않게 한다.
"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyCount } from "@/features/analytics/types";

export interface TrendBarChartProps {
  data: DailyCount[];
  loading?: boolean;
}

export default function TrendBarChart({ data, loading }: TrendBarChartProps) {
  if (loading) return <Skeleton className="h-52 w-full" />;
  if (data.length === 0) {
    return (
      <div className="h-52 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">데이터가 없습니다</p>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={208}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
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
  );
}
