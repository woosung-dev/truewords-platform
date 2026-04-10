"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { chatbotAPI } from "@/features/chatbot/api";
import { dataAPI } from "@/features/data-source/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Database, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";

function StatCard({
  label,
  value,
  icon: Icon,
  color = "default",
  loading,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color?: "default" | "green" | "red" | "blue";
  loading?: boolean;
}) {
  const colorMap = {
    default: "text-foreground",
    green: "text-emerald-600",
    red: "text-destructive",
    blue: "text-primary",
  };

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <p className={`text-3xl font-bold tracking-tight ${colorMap[color]}`}>
          {value.toLocaleString()}
        </p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { data: chatbots, isLoading: chatbotsLoading } = useQuery({
    queryKey: ["chatbots", 0],
    queryFn: () => chatbotAPI.list(100, 0),
  });

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["ingest-status"],
    queryFn: dataAPI.getStatus,
    staleTime: 30000, // 30초 캐시 (불필요한 폴링 제거)
  });

  const totalChatbots = chatbots?.total ?? 0;
  const activeChatbots = chatbots?.items.filter((c) => c.is_active).length ?? 0;
  const totalChunks = status?.summary.total_chunks ?? 0;
  const failedFiles = status?.summary.failed_count ?? 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
        <p className="text-sm text-muted-foreground mt-1">
          시스템 현황을 한눈에 확인합니다
        </p>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="전체 챗봇"
          value={totalChatbots}
          icon={Bot}
          loading={chatbotsLoading}
        />
        <StatCard
          label="활성 챗봇"
          value={activeChatbots}
          icon={CheckCircle2}
          color="green"
          loading={chatbotsLoading}
        />
        <StatCard
          label="총 청크 수"
          value={totalChunks}
          icon={Database}
          color="blue"
          loading={statusLoading}
        />
        <StatCard
          label="처리 실패"
          value={failedFiles}
          icon={AlertCircle}
          color={failedFiles > 0 ? "red" : "default"}
          loading={statusLoading}
        />
      </div>

      {/* 빠른 이동 */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
          빠른 이동
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/chatbots"
            className="group flex items-center justify-between rounded-xl border bg-card p-5 hover:border-primary/50 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">챗봇 관리</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  챗봇 설정 및 검색 티어 구성
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </Link>

          <Link
            href="/data-sources"
            className="group flex items-center justify-between rounded-xl border bg-card p-5 hover:border-primary/50 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Database className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">데이터 소스</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  RAG 지식 베이스 문서 업로드
                </p>
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
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              최근 챗봇
            </h2>
            <Link
              href="/chatbots"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              전체 보기 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="rounded-xl border bg-card overflow-hidden">
            {chatbots.items.slice(0, 5).map((config, i) => (
              <Link
                key={config.id}
                href={`/chatbots/${config.id}/edit`}
                className={`flex items-center justify-between px-5 py-3.5 hover:bg-accent/50 transition-colors ${
                  i !== 0 ? "border-t" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      config.is_active ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                  />
                  <span className="font-medium text-sm truncate">
                    {config.display_name}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
                    {config.chatbot_id}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  티어 {config.search_tiers?.tiers?.length ?? 0}개
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
