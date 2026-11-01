// 일별 모드 분포 누적 막대 그래프 본체. recharts 가 커서 ModesChart 가 next/dynamic(ssr: false)으로 늦게 싣는다.
"use client";

import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MODES, type Mode } from "./modes";

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

export default function ModesBars({ data }: { data: ({ date: string } & Partial<Record<Mode, number>>)[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
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
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {MODES.map((mode) => (
          <Bar key={mode} dataKey={mode} name={MODE_LABEL[mode]} stackId="modes" fill={MODE_COLOR[mode]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
