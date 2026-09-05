"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { chatbotAPI } from "@/features/chatbot/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 20;

export default function ChatbotsPage() {
  const [page, setPage] = useState(0);
  const [showInactive, setShowInactive] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["chatbots", page],
    queryFn: () => chatbotAPI.list(PAGE_SIZE, page * PAGE_SIZE),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  // 비활성 숨김 (기본) — 데이터 소스 카테고리 페이지와 동일 패턴
  const allItems = data?.items ?? [];
  const inactiveCount = allItems.filter((c) => !c.is_active).length;
  const visibleItems = showInactive
    ? allItems
    : allItems.filter((c) => c.is_active);

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">챗봇 관리</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              총 {data.total}개
              {!showInactive && inactiveCount > 0 && (
                <span className="text-xs ml-1">
                  · 활성 {data.total - inactiveCount}개 표시
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {inactiveCount > 0 && (
            <button
              onClick={() => setShowInactive((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showInactive
                ? "비활성 숨기기"
                : `비활성 ${inactiveCount}개 보기`}
            </button>
          )}
          <Link href="/chatbots/new" className={buttonVariants({ size: "sm" })}>
            <Plus className="w-4 h-4 mr-1.5" />
            새 챗봇
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border bg-card overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`px-5 py-4 ${i !== 0 ? "border-t" : ""}`}>
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <p className="text-muted-foreground text-sm">목록을 불러올 수 없습니다.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : data && data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <p className="text-muted-foreground text-sm">
            등록된 챗봇이 없습니다. 첫 챗봇을 만들어보세요.
          </p>
          <Link
            href="/chatbots/new"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            새 챗봇 만들기
          </Link>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <p className="text-muted-foreground text-sm">
            활성 챗봇이 없습니다.
          </p>
          {inactiveCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInactive(true)}
            >
              비활성 {inactiveCount}개 보기
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-admin-muted/40 hover:bg-admin-muted/40">
                  <TableHead className="font-semibold text-foreground">이름</TableHead>
                  <TableHead className="font-semibold text-foreground">Chatbot ID</TableHead>
                  <TableHead className="font-semibold text-foreground">상태</TableHead>
                  <TableHead className="font-semibold text-foreground">티어</TableHead>
                  <TableHead className="font-semibold text-foreground">최근 수정</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((config) => (
                  <TableRow
                    key={config.id}
                    className="hover:bg-admin-muted/30 transition-colors"
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            config.is_active ? "bg-success" : "bg-admin-muted-foreground/40"
                          }`}
                        />
                        {config.display_name}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {config.chatbot_id}
                    </TableCell>
                    <TableCell>
                      {config.is_active ? (
                        <Badge className="bg-success-soft text-success hover:bg-success-soft border border-success-border">
                          활성
                        </Badge>
                      ) : (
                        <Badge className="bg-secondary text-muted-foreground hover:bg-secondary border border-border">
                          비활성
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {config.search_tiers?.tiers?.length ?? 0}개
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(config.updated_at).toLocaleDateString("ko-KR")}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/chatbots/${config.id}/edit`}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                          className: "text-muted-foreground hover:text-foreground",
                        })}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1.5" />
                        편집
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground px-2">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
