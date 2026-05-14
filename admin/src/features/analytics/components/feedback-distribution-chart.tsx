// 피드백 유형 분포 PieChart — feedback/page.tsx 의 차트 영역 분리.
// next/dynamic 으로 lazy load 해 recharts 번들이 entry chunk 에 들어가지 않게 한다.
"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

// cool slate × admin amber 충돌 회피 팔레트.
const FEEDBACK_COLORS: Record<string, string> = {
  helpful: "#0d9488",
  inaccurate: "#dc2626",
  missing_citation: "#ea580c",
  irrelevant: "#64748b",
  other: "#7c3aed",
};

const FEEDBACK_LABELS: Record<string, string> = {
  helpful: "도움됨",
  inaccurate: "부정확",
  missing_citation: "출처 부족",
  irrelevant: "관련 없음",
  other: "기타",
};

function normalizeFeedbackType(t: string): string {
  return (t || "").toLowerCase();
}

export interface FeedbackDistributionChartProps {
  data?: { feedback_type: string; count: number }[];
  loading: boolean;
}

export default function FeedbackDistributionChart({
  data,
  loading,
}: FeedbackDistributionChartProps) {
  if (loading) return <Skeleton className="h-64 w-full" />;
  const chartData = (data ?? []).map((d) => {
    const key = normalizeFeedbackType(d.feedback_type);
    return {
      name: FEEDBACK_LABELS[key] ?? d.feedback_type,
      value: d.count,
      color: FEEDBACK_COLORS[key] ?? "#94a3b8",
    };
  });

  if (chartData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">피드백이 없습니다</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={90}
          innerRadius={48}
          paddingAngle={2}
        >
          {chartData.map((entry, index) => (
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
            boxShadow:
              "0 8px 24px oklch(0 0 0 / 0.10), 0 2px 4px oklch(0 0 0 / 0.06)",
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
