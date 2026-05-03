"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import { analyticsAPI } from "@/features/analytics/api";
import type { NegativeFeedbackItem } from "@/features/analytics/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import SessionDetailModal from "@/features/analytics/components/session-detail-modal";

// ─────────────────────────────────────────────
// 피드백 유형 상수
// ─────────────────────────────────────────────
const FEEDBACK_COLORS: Record<string, string> = {
  helpful: "#10b981",
  inaccurate: "#ef4444",
  missing_citation: "#f59e0b",
  irrelevant: "#6b7280",
  other: "#8b5cf6",
};

const FEEDBACK_LABELS: Record<string, string> = {
  helpful: "도움됨",
  inaccurate: "부정확",
  missing_citation: "출처 부족",
  irrelevant: "관련 없음",
  other: "기타",
};

// ─────────────────────────────────────────────
// 피드백 Badge 변형 매핑
// ─────────────────────────────────────────────
type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function getBadgeVariant(feedbackType: string): BadgeVariant {
  switch (feedbackType) {
    case "inaccurate":
      return "destructive";
    case "missing_citation":
      return "outline";
    case "irrelevant":
      return "secondary";
    default:
      return "secondary";
  }
}

// ─────────────────────────────────────────────
// 날짜 포맷 (ko-KR, YYYY.MM.DD HH:mm)
// ─────────────────────────────────────────────
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\. /g, ".")
    .replace(/\.$/, "");
}

// ─────────────────────────────────────────────
// 피드백 유형 분포 PieChart
// ─────────────────────────────────────────────
function FeedbackDistributionChart({
  data,
  loading,
}: {
  data?: { feedback_type: string; count: number }[];
  loading: boolean;
}) {
  const chartData = (data ?? []).map((d) => ({
    name: FEEDBACK_LABELS[d.feedback_type] ?? d.feedback_type,
    value: d.count,
    color: FEEDBACK_COLORS[d.feedback_type] ?? "#94a3b8",
  }));

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">피드백 유형 분포</h2>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">피드백이 없습니다</p>
        </div>
      ) : (
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
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
              }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 최근 부정 피드백 테이블
// ─────────────────────────────────────────────
function FeedbackTable({
  polarity,
  onPolarityChange,
  items,
  loading,
  onSelectSession,
}: {
  polarity: "positive" | "negative";
  onPolarityChange: (p: "positive" | "negative") => void;
  items?: NegativeFeedbackItem[];
  loading: boolean;
  onSelectSession: (sessionId: string) => void;
}) {
  const polarityLabel = polarity === "positive" ? "긍정" : "부정";
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">최근 {polarityLabel} 피드백</h2>
        <div className="inline-flex rounded-lg border bg-admin-muted/40 p-0.5 text-xs">
          {(["negative", "positive"] as const).map((p) => (
            <button
              key={p}
              onClick={() => onPolarityChange(p)}
              className={`px-3 py-1 rounded-md transition-colors ${
                polarity === p
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "positive" ? "👍 긍정" : "👎 부정"}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        행을 클릭하면 해당 세션의 전체 대화를 볼 수 있습니다
      </p>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {polarityLabel} 피드백이 없습니다
        </p>
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-admin-muted/50 border-b">
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                  시간
                </th>
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                  봇
                </th>
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">
                  질문
                </th>
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">
                  답변
                </th>
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                  유형
                </th>
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">
                  코멘트
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={item.id}
                  className={`cursor-pointer hover:bg-admin-muted/30 transition-colors ${i !== 0 ? "border-t" : ""}`}
                  onClick={() => onSelectSession(item.session_id)}
                >
                  <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="py-2 px-3 text-xs whitespace-nowrap">
                    {item.chatbot_name ?? "-"}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className="block truncate max-w-[200px] text-xs"
                      title={item.question}
                    >
                      {item.question}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className="block truncate max-w-[200px] text-xs text-muted-foreground"
                      title={item.answer_snippet}
                    >
                      {item.answer_snippet}
                    </span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <Badge variant={getBadgeVariant(item.feedback_type)}>
                      {FEEDBACK_LABELS[item.feedback_type] ?? item.feedback_type}
                    </Badge>
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className="block truncate max-w-[200px] text-xs text-muted-foreground"
                      title={item.comment ?? ""}
                    >
                      {item.comment ?? "-"}
                    </span>
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
export default function FeedbackPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["feedback-summary"],
    queryFn: () => analyticsAPI.getFeedbackSummary(30),
  });

  const [polarity, setPolarity] = useState<"positive" | "negative">("negative");

  const { data: feedbackList, isLoading: feedbackLoading } = useQuery({
    queryKey: ["feedback-list", polarity],
    queryFn: () => analyticsAPI.getFeedbackList(polarity, 20, 0),
  });

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );

  return (
    <div className="space-y-6 max-w-5xl">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">피드백 대시보드</h1>
        <p className="text-sm text-muted-foreground mt-1">
          사용자 피드백을 분석합니다
        </p>
      </div>

      {/* 피드백 유형 분포 */}
      <FeedbackDistributionChart
        data={summary?.distribution}
        loading={summaryLoading}
      />

      {/* 피드백 목록 (긍정/부정 토글) */}
      <FeedbackTable
        polarity={polarity}
        onPolarityChange={setPolarity}
        items={feedbackList}
        loading={feedbackLoading}
        onSelectSession={setSelectedSessionId}
      />

      {/* 세션 상세 모달 */}
      <SessionDetailModal
        open={selectedSessionId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSessionId(null);
        }}
        sessionId={selectedSessionId}
      />
    </div>
  );
}
