// 피드백 유형 분포 도넛 그래프 본체. recharts 가 커서 피드백 화면이 next/dynamic(ssr: false)으로 늦게 싣는다.
"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export default function FeedbackPie({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={256}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={90}
          innerRadius={48}
          paddingAngle={2}
        >
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          cursor={{ fill: "var(--color-admin-muted)", opacity: 0.4 }}
          wrapperStyle={{ outline: "none", zIndex: 50 }}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "var(--color-card)",
            color: "var(--color-foreground)",
            boxShadow: "0 8px 24px oklch(0 0 0 / 0.10), 0 2px 4px oklch(0 0 0 / 0.06)",
            padding: "8px 12px",
          }}
          itemStyle={{ color: "var(--color-foreground)" }}
          labelStyle={{ color: "var(--color-foreground)", fontWeight: 600 }}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
