"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Bot, CheckCircle2, Database, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { QueryErrorNotice } from "@/components/query-error-notice";
import { StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { analyticsAPI } from "@/features/analytics/api";
import { chatbotAPI } from "@/features/chatbot/api";
import { dataAPI } from "@/features/data-source/api";

export default function DashboardPage() {
  const {
    data: chatbots,
    isLoading: chatbotsLoading,
    isError: chatbotsError,
    isFetching: chatbotsFetching,
    refetch: refetchChatbots,
  } = useQuery({
    queryKey: ["chatbots", 0],
    queryFn: () => chatbotAPI.list(100, 0),
  });

  const {
    data: status,
    isLoading: statusLoading,
    isError: statusError,
    isFetching: statusFetching,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ["ingest-status"],
    queryFn: dataAPI.getStatus,
    staleTime: 30000,
  });

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    isFetching: summaryFetching,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: analyticsAPI.getDashboardSummary,
    staleTime: 60000,
  });

  const totalChatbots = chatbots?.total;
  const activeChatbots = chatbots?.items.filter((c) => c.is_active).length;
  const totalChunks = status?.summary.total_chunks;
  const failedFiles = status?.summary.failed_count;
  const todayQuestions = summary?.today_questions;
  const weekQuestions = summary?.week_questions;
  const helpfulCount = summary?.feedback_helpful;
  const negativeCount = summary?.feedback_negative;

  return (
    <div className="space-y-6 page-wide">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
        <p className="text-sm text-muted-foreground mt-1">시스템 현황을 한눈에 확인합니다</p>
      </div>

      {chatbotsError && (
        <QueryErrorNotice
          message="챗봇 현황을 불러오지 못했습니다."
          hasPreviousData={chatbots !== undefined}
          isRetrying={chatbotsFetching}
          onRetry={() => void refetchChatbots()}
        />
      )}
      {statusError && (
        <QueryErrorNotice
          message="문서 처리 현황을 불러오지 못했습니다."
          hasPreviousData={status !== undefined}
          isRetrying={statusFetching}
          onRetry={() => void refetchStatus()}
        />
      )}
      {/* KPI 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="전체 챗봇" value={totalChatbots} icon={Bot} loading={chatbotsLoading} />
        <StatCard label="활성 챗봇" value={activeChatbots} icon={CheckCircle2} loading={chatbotsLoading} />
        <StatCard label="총 청크 수" value={totalChunks} icon={Database} loading={statusLoading} />
        <StatCard
          label="처리 실패"
          value={failedFiles}
          icon={AlertCircle}
          tone={(failedFiles ?? 0) > 0 ? "danger" : "default"}
          loading={statusLoading}
        />
      </div>

      {/* 검색 & 피드백 메트릭 */}
      {summaryError && (
        <QueryErrorNotice
          message="시스템 요약을 불러오지 못했습니다."
          hasPreviousData={summary !== undefined}
          isRetrying={summaryFetching}
          onRetry={() => void refetchSummary()}
        />
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="오늘 질문" value={todayQuestions} icon={Search} loading={summaryLoading} />
        <StatCard label="이번 주 질문" value={weekQuestions} icon={Search} loading={summaryLoading} />
        <StatCard label="긍정 피드백" value={helpfulCount} icon={ThumbsUp} loading={summaryLoading} />
        <StatCard
          label="부정 피드백"
          value={negativeCount}
          icon={ThumbsDown}
          tone={(negativeCount ?? 0) > 0 ? "danger" : "default"}
          loading={summaryLoading}
        />
      </div>

      {/* 빠른 이동 */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">빠른 이동</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/chatbots"
            className="group flex items-center justify-between rounded-xl border bg-card p-5 hover:border-primary/50 hover:bg-primary/5 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">챗봇 관리</p>
                <p className="text-xs text-muted-foreground mt-0.5">챗봇 설정 및 검색 티어 구성</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </Link>

          <Link
            href="/data-sources"
            className="group flex items-center justify-between rounded-xl border bg-card p-5 hover:border-primary/50 hover:bg-primary/5 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Database className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">데이터 소스</p>
                <p className="text-xs text-muted-foreground mt-0.5">RAG 지식 베이스 문서 업로드</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </Link>
        </div>
      </div>

      {/* 최근 챗봇 목록 */}
      {!chatbotsLoading && chatbots && chatbots.items.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">최근 챗봇</h2>
            <Link href="/chatbots" className="text-xs text-primary hover:underline flex items-center gap-1">
              전체 보기 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <Card className="p-0 overflow-hidden">
            {chatbots.items.slice(0, 5).map((config, i) => (
              <Link
                key={config.id}
                href={`/chatbots/${config.id}/edit`}
                className={`flex items-center justify-between px-5 py-3.5 hover:bg-primary/5 transition-colors ${
                  i !== 0 ? "border-t" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      config.is_active ? "bg-success" : "bg-muted-foreground/40"
                    }`}
                  />
                  <span className="font-medium text-sm truncate">{config.display_name}</span>
                  <span className="text-xs text-muted-foreground font-mono hidden sm:inline">{config.chatbot_id}</span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  티어 {config.search_tiers?.tiers?.length ?? 0}개
                </span>
              </Link>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
