"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAPI } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface AuditLog {
  id: string;
  admin_user_id: string;
  action: string;
  target_table: string;
  target_id: string;
  changes: Record<string, unknown>;
  created_at: string;
}

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

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit-logs", offset],
    queryFn: () =>
      fetchAPI<AuditLog[]>(
        `/admin/audit-logs?limit=${PAGE_SIZE}&offset=${offset}`
      ),
  });

  const hasPrev = offset > 0;
  const hasNext = logs.length === PAGE_SIZE;

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">감사 로그</h1>
        <p className="text-sm text-muted-foreground mt-1">
          관리자 작업 이력을 확인합니다
        </p>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="text-left font-medium px-4 py-2.5">시간</th>
              <th className="text-left font-medium px-4 py-2.5">액션</th>
              <th className="text-left font-medium px-4 py-2.5">대상 테이블</th>
              <th className="text-left font-medium px-4 py-2.5 hidden md:table-cell">
                변경 내용
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b">
                  <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-5 w-12" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                  <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-48" /></td>
                </tr>
              ))}
            {!isLoading && logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                  감사 로그가 없습니다
                </td>
              </tr>
            )}
            {logs.map((log) => {
              const actionInfo = ACTION_LABELS[log.action] ?? {
                label: log.action,
                variant: "outline" as const,
              };
              return (
                <tr key={log.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={actionInfo.variant}>{actionInfo.label}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {log.target_table}
                    </code>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground truncate block max-w-xs">
                      {Object.keys(log.changes).length > 0
                        ? JSON.stringify(log.changes).slice(0, 100)
                        : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {offset + 1}–{offset + logs.length}건
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!hasPrev}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            이전
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!hasNext}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            다음
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
