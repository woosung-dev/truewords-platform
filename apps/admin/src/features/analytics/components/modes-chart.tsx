// 일별 resolved_answer_mode 분포 차트 (BL-6 — 4주 시범 운영 baseline)
"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { Skeleton } from "@truewords/ui-web/components/ui/skeleton";
import type { DailyModeCount } from "@/features/analytics/types";

const MODES = ["standard", "theological", "pastoral", "beginner", "kids"] as const;
type Mode = (typeof MODES)[number];

const MODE_LABEL: Record<Mode, string> = {
  standard: "표준",
  theological: "신학자",
  pastoral: "목회상담",
  beginner: "초신자",
  kids: "어린이",
};

const MODE_COLOR: Record<Mode, string> = {
  standard: "#475569", // slate-600
  theological: "#6366f1", // indigo-500
  pastoral: "#e11d48", // rose-600
  beginner: "#f59e0b", // amber-500
  kids: "#0ea5e9", // sky-500
};

type PivotRow = { date: string } & Partial<Record<Mode, number>>;

function pivotToDate(rows: DailyModeCount[]): PivotRow[] {
  // override true/false/null 통합 후 mode 별 합산 (override 분포는 별도 표시 필요 시 확장)
  const map = new Map<string, PivotRow>();
  for (const r of rows) {
    const dateKey = r.date.slice(5); // "2026-05-14" → "05-14"
    const existing = map.get(dateKey) ?? { date: dateKey };
    const mode = r.mode as Mode;
    if (MODES.includes(mode)) {
      existing[mode] = (existing[mode] ?? 0) + r.count;
    }
    map.set(dateKey, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function computeOverrideRate(rows: DailyModeCount[]): {
  pastoralOverride: number;
  totalPastoral: number;
} {
  // persona_overridden=true 인 row 만 추출 (NULL/legacy 는 제외 — codex P2 의미 분리)
  let pastoralOverride = 0;
  let totalPastoral = 0;
  for (const r of rows) {
    if (r.mode === "pastoral") {
      totalPastoral += r.count;
      if (r.persona_overridden === true) pastoralOverride += r.count;
    }
  }
  return { pastoralOverride, totalPastoral };
}

export function ModesChart({
  rows,
  loading,
}: {
  rows?: DailyModeCount[];
  loading: boolean;
}) {
  const chartData = pivotToDate(rows ?? []);
  const { pastoralOverride, totalPastoral } = computeOverrideRate(rows ?? []);
  const overrideRate =
    totalPastoral > 0
      ? Math.round((pastoralOverride / totalPastoral) * 100)
      : 0;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          일별 모드 분포 (최근 30일, UTC 기준)
        </h2>
        {totalPastoral > 0 && (
          <span className="text-xs text-muted-foreground">
            pastoral 위기 override {pastoralOverride}/{totalPastoral} ({overrideRate}%)
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-52 w-full" />
      ) : chartData.length === 0 ? (
        <div className="h-52 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">데이터가 없습니다</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: -16, bottom: 0 }}
          >
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
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {MODES.map((mode) => (
              <Bar
                key={mode}
                dataKey={mode}
                name={MODE_LABEL[mode]}
                stackId="modes"
                fill={MODE_COLOR[mode]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
