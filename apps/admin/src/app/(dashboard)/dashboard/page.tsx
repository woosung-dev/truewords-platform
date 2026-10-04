"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LoadError } from "@/components/load-error";
import { METRIC_ERROR, type Metric, MetricBand } from "@/components/metric-band";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { analyticsAPI } from "@/features/analytics/api";
import SessionDetailModal from "@/features/analytics/components/session-detail-modal";
import type { NegativeFeedbackItem } from "@/features/analytics/types";
import { chatbotAPI } from "@/features/chatbot/api";
import { dataAPI } from "@/features/data-source/api";
import { formatShortDateTime } from "@/lib/utils";

// "확인할 것"에 올리는 부정 피드백 범위. 누적 숫자는 KPI 띠에 있고, 여기는 최근 것만 본다.
const RECENT_NEGATIVE_DAYS = 7;
const RECENT_NEGATIVE_LIMIT = 3;

export default function DashboardPage() {
  const chatbotsQuery = useQuery({
    queryKey: ["chatbots", 0],
    queryFn: () => chatbotAPI.list(100, 0),
  });

  const statusQuery = useQuery({
    queryKey: ["ingest-status"],
    queryFn: dataAPI.getStatus,
    staleTime: 30000,
  });

  const summaryQuery = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: analyticsAPI.getDashboardSummary,
    staleTime: 60000,
  });

  const negativeQuery = useQuery({
    queryKey: ["feedback-list", "negative", RECENT_NEGATIVE_DAYS, RECENT_NEGATIVE_LIMIT],
    queryFn: () => analyticsAPI.getFeedbackList("negative", RECENT_NEGATIVE_LIMIT, 0, RECENT_NEGATIVE_DAYS),
    staleTime: 60000,
  });

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const chatbots = chatbotsQuery.data;
  const status = statusQuery.data;
  const summary = summaryQuery.data;
  const failedQueries = [chatbotsQuery, statusQuery, summaryQuery, negativeQuery].filter((q) => q.isError);

  const activeChatbots = chatbots?.items.filter((c) => c.is_active).length ?? 0;
  const negativeCount = summary?.feedback_negative ?? 0;

  const metrics: Metric[] = [
    chatbotsQuery.isError
      ? { label: "활성 챗봇", ...METRIC_ERROR }
      : { label: "활성 챗봇", value: `${activeChatbots} / ${chatbots?.total ?? 0}`, loading: chatbotsQuery.isLoading },
    summaryQuery.isError
      ? { label: "오늘 질문", ...METRIC_ERROR }
      : { label: "오늘 질문", value: summary?.today_questions ?? 0, loading: summaryQuery.isLoading },
    summaryQuery.isError
      ? { label: "이번 주 질문", ...METRIC_ERROR }
      : { label: "이번 주 질문", value: summary?.week_questions ?? 0, loading: summaryQuery.isLoading },
    summaryQuery.isError
      ? { label: "부정 피드백", ...METRIC_ERROR }
      : {
          label: "부정 피드백",
          value: negativeCount,
          hint: "누적",
          tone: negativeCount > 0 ? "danger" : undefined,
          loading: summaryQuery.isLoading,
        },
  ];

  return (
    <div className="space-y-6 page-wide">
      <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>

      {failedQueries.length > 0 && (
        <LoadError
          message="일부 지표를 불러오지 못했습니다."
          onRetry={() => {
            for (const q of failedQueries) q.refetch();
          }}
        />
      )}

      <div className="space-y-2">
        <MetricBand metrics={metrics} />
        {statusQuery.isLoading || summaryQuery.isLoading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <p className="text-sm text-muted-foreground tabular-nums">
            청크 {status ? status.summary.total_chunks.toLocaleString() : "—"} · 긍정 피드백{" "}
            {summary ? summary.feedback_helpful.toLocaleString() : "—"}
          </p>
        )}
      </div>

      <section aria-labelledby="todo-heading" className="space-y-3">
        <h2 id="todo-heading" className="text-base font-semibold">
          확인할 것
        </h2>
        <TodoList
          failedFiles={status?.summary.failed_count}
          negatives={negativeQuery.data}
          loading={statusQuery.isLoading || negativeQuery.isLoading}
          partialError={statusQuery.isError || negativeQuery.isError}
          onSelectSession={setSelectedSessionId}
        />
      </section>

      {/* 최근 챗봇 목록 */}
      {chatbots && chatbots.items.length > 0 && (
        <section aria-labelledby="recent-chatbots-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="recent-chatbots-heading" className="text-base font-semibold">
              최근 챗봇
            </h2>
            <Link href="/chatbots" className="text-xs text-primary hover:underline flex items-center gap-1">
              전체 보기 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="rounded-lg border bg-card overflow-hidden">
            {chatbots.items.slice(0, 5).map((config, i) => (
              <Link
                key={config.id}
                href={`/chatbots/${config.id}/edit`}
                className={`flex items-center justify-between px-5 py-3.5 hover:bg-primary/5 transition-colors ${
                  i !== 0 ? "border-t" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* 상태 열이 없는 목록이라 점 하나로만 알리고, 글자는 스크린 리더에 준다. */}
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      config.is_active ? "bg-success" : "bg-muted-foreground/40"
                    }`}
                  />
                  <span className="sr-only">{config.is_active ? "활성" : "비활성"}</span>
                  <span className="font-medium text-sm truncate">{config.display_name}</span>
                  <span className="text-xs text-muted-foreground font-mono hidden sm:inline">{config.chatbot_id}</span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  티어 {config.search_tiers?.tiers?.length ?? 0}개
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

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

/** 운영자가 지금 손봐야 할 것만 모은다. 둘 다 없으면 한 줄로 끝낸다. */
function TodoList({
  failedFiles,
  negatives,
  loading,
  partialError,
  onSelectSession,
}: {
  failedFiles?: number;
  negatives?: NegativeFeedbackItem[];
  loading: boolean;
  partialError: boolean;
  onSelectSession: (sessionId: string) => void;
}) {
  if (loading) {
    return <Skeleton className="h-12 w-full" />;
  }

  const hasFailed = (failedFiles ?? 0) > 0;
  const hasNegatives = (negatives?.length ?? 0) > 0;

  return (
    <div className="rounded-lg border bg-card divide-y">
      {hasFailed && (
        <Link href="/data-sources" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-admin-muted/40">
          <StatusBadge tone="danger">처리 실패</StatusBadge>
          <span>문서 {failedFiles}건을 처리하지 못했어요</span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      )}
      {negatives?.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelectSession(item.session_id)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-admin-muted/40"
        >
          <StatusBadge tone="warning">부정 피드백</StatusBadge>
          <span className="min-w-0 flex-1 truncate" title={item.question}>
            {item.question}
          </span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {item.chatbot_name ?? "-"} · {formatShortDateTime(item.created_at)}
          </span>
        </button>
      ))}
      {hasNegatives && (
        <Link href="/feedback" className="flex items-center gap-1 px-4 py-2.5 text-xs text-primary hover:underline">
          피드백 화면에서 모두 보기 <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      )}
      {!hasFailed && !hasNegatives && (
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          {partialError ? (
            "불러오지 못했어요."
          ) : (
            <>
              <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
              지금 확인할 항목이 없어요.
            </>
          )}
        </p>
      )}
    </div>
  );
}
