"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { chatbotAPI } from "@/lib/api";
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

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["chatbots", page],
    queryFn: () => chatbotAPI.list(PAGE_SIZE, page * PAGE_SIZE),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">챗봇 관리</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              총 {data.total}개
            </p>
          )}
        </div>
        <Link href="/chatbots/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="w-4 h-4 mr-1.5" />
          새 챗봇
        </Link>
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
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="font-semibold text-foreground">이름</TableHead>
                  <TableHead className="font-semibold text-foreground">Chatbot ID</TableHead>
                  <TableHead className="font-semibold text-foreground">상태</TableHead>
                  <TableHead className="font-semibold text-foreground">티어</TableHead>
                  <TableHead className="font-semibold text-foreground">최근 수정</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((config) => (
                  <TableRow
                    key={config.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            config.is_active ? "bg-emerald-500" : "bg-slate-300"
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
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">
                          활성
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500 hover:bg-slate-100 border-0">
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
