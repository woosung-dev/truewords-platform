"use client";

import { useQuery } from "@tanstack/react-query";
import type { AuditLogResponse as AuditLog } from "@truewords/api-client-ts/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { QueryErrorNotice } from "@/components/query-error-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAPI } from "@/lib/api";

const PAGE_SIZE = 20;

const ACTION_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  create: { label: "생성", variant: "default" },
  update: { label: "수정", variant: "secondary" },
  delete: { label: "삭제", variant: "destructive" },
  login: { label: "로그인", variant: "outline" },
  logout: { label: "로그아웃", variant: "outline" },
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuditLogsPage() {
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const {
    data: logs,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["audit-logs", offset],
    queryFn: () => fetchAPI<AuditLog[]>(`/admin/audit-logs?limit=${PAGE_SIZE}&offset=${offset}`),
  });

  const hasPrev = offset > 0;
  const hasNext = logs?.length === PAGE_SIZE;

  return (
    <div className="page-wide space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">감사 로그</h1>
        <p className="text-sm text-muted-foreground mt-1">관리자 작업 이력을 확인합니다</p>
      </div>

      {isError && (
        <QueryErrorNotice
          message="감사 로그를 불러오지 못했습니다."
          hasPreviousData={logs !== undefined}
          isRetrying={isFetching}
          onRetry={() => void refetch()}
        />
      )}
      {(!isError || logs !== undefined) && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b bg-admin-muted/40">
                <th className="w-28 text-left font-medium px-3 py-2.5">시간</th>
                <th className="w-20 text-left font-medium px-3 py-2.5">액션</th>
                <th className="text-left font-medium px-3 py-2.5">대상 · 변경 내용</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-5 w-12" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {!isLoading && logs?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-muted-foreground">
                    감사 로그가 없습니다
                  </td>
                </tr>
              )}
              {logs?.map((log) => {
                const actionInfo = ACTION_LABELS[log.action] ?? {
                  label: log.action,
                  variant: "outline" as const,
                };
                return (
                  <Fragment key={log.id}>
                    <tr className="border-b last:border-0 hover:bg-primary/5">
                      <td className="px-3 py-3 align-top text-xs text-muted-foreground tabular-nums">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Badge variant={actionInfo.variant}>{actionInfo.label}</Badge>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <code className="block w-fit max-w-full break-all text-xs bg-admin-muted px-1.5 py-0.5 rounded">
                          {log.target_table}
                        </code>
                        {Object.keys(log.changes).length > 0 && (
                          <button
                            type="button"
                            className="min-h-11 py-2 text-left text-xs text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                            aria-expanded={expandedId === log.id}
                            aria-controls={`audit-change-${log.id}`}
                            onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                          >
                            {expandedId === log.id ? "변경 내용 접기" : "변경 내용 보기"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedId === log.id && (
                      <tr>
                        <td colSpan={3} className="border-b p-3">
                          <pre
                            id={`audit-change-${log.id}`}
                            tabIndex={0}
                            aria-label="전체 변경 내용"
                            className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-admin-muted p-3 text-xs leading-relaxed"
                          >
                            {JSON.stringify(log.changes, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      {logs !== undefined && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {logs.length === 0 ? "0건" : `${offset + 1}–${offset + logs.length}건`}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!hasPrev || isFetching}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              이전
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasNext || isFetching}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
            >
              다음
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
