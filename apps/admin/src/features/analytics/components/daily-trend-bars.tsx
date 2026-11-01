// 일별 검색량 막대 그래프 본체. recharts 가 커서 검색 분석 화면이 next/dynamic(ssr: false)으로 늦게 싣는다.
"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyCount } from "@/features/analytics/types";

export default function DailyTrendBars({ data }: { data: DailyCount[] }) {
  return (
    <ResponsiveContainer width="100%" height={208}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
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
        <Bar dataKey="count" name="검색 수" fill="var(--primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
