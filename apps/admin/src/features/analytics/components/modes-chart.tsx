// 일별 resolved_answer_mode 분포 차트 (BL-6 — 4주 시범 운영 baseline)
"use client";

import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyModeCount } from "@/features/analytics/types";
import { formatShortDate } from "@/lib/utils";

const MODES = ["standard", "theological", "pastoral", "beginner", "kids"] as const;
type Mode = (typeof MODES)[number];

const MODE_LABEL: Record<Mode, string> = {
  standard: "표준",
  theological: "신학자",
  pastoral: "목회상담",
  beginner: "초신자",
  kids: "어린이",
};

// globals.css 의 차트·카테고리 토큰만 쓴다 — 흰 배경 위 비텍스트 대비 3:1 이상(5.2~13:1).
const MODE_COLOR: Record<Mode, string> = {
  standard: "var(--tw-cat-slate)",
  theological: "var(--chart-1)", // navy
  pastoral: "var(--chart-4)", // 목회 청록(pastoral)
  beginner: "var(--chart-2)", // brass
  kids: "var(--tw-cat-rose)",
};

type PivotRow = { date: string } & Partial<Record<Mode, number>>;

function pivotToDate(rows: DailyModeCount[]): PivotRow[] {
  // override true/false/null 통합 후 mode 별 합산 (override 분포는 별도 표시 필요 시 확장)
  const map = new Map<string, PivotRow>();
  for (const r of rows) {
    const dateKey = r.date.slice(0, 10); // 축·툴팁에서 "5/14"로 줄여 보인다
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
  // persona_overridden=true 인 row 만 추출 (NULL/legacy 는 측정값이 없으므로 제외)
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

/** 차트를 못 보는 사용자를 위한 한 줄 요약. 모드별 합계를 많은 순으로 말한다. */
function modesSummary(rows: DailyModeCount[]): string {
  const totals = MODES.map((mode) => ({
    mode,
    count: rows.filter((r) => r.mode === mode).reduce((sum, r) => sum + r.count, 0),
  }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
  const parts = totals.map((t) => `${MODE_LABEL[t.mode]} ${t.count.toLocaleString()}건`).join(", ");
  return `최근 30일 모드 분포: ${parts}`;
}

export function ModesChart({
  rows,
  loading,
  error = false,
}: {
  rows?: DailyModeCount[];
  loading: boolean;
  error?: boolean;
}) {
  const chartData = pivotToDate(rows ?? []);
  const { pastoralOverride, totalPastoral } = computeOverrideRate(rows ?? []);
  const overrideRate = totalPastoral > 0 ? Math.round((pastoralOverride / totalPastoral) * 100) : 0;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">일별 모드 분포 (최근 30일, UTC 기준)</h2>
        {totalPastoral > 0 && (
          <span className="text-xs text-muted-foreground">
            pastoral 위기 override {pastoralOverride}/{totalPastoral} ({overrideRate}%)
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-52 w-full" />
      ) : error ? (
        <p className="text-sm text-muted-foreground">불러오지 못했어요.</p>
      ) : chartData.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          최근 30일 동안 답변 기록이 없어요. 사용자 웹에서 질문이 들어오면 모드별로 쌓여요.
        </p>
      ) : (
        <div role="img" aria-label={modesSummary(rows ?? [])}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
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
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {MODES.map((mode) => (
                <Bar key={mode} dataKey={mode} name={MODE_LABEL[mode]} stackId="modes" fill={MODE_COLOR[mode]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
