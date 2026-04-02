"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { chatbotAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
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

const PAGE_SIZE = 20;

export default function ChatbotsPage() {
  const [page, setPage] = useState(0);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["chatbots", page],
    queryFn: () => chatbotAPI.list(PAGE_SIZE, page * PAGE_SIZE),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">챗봇 관리</h1>
        <Button render={<Link href="/chatbots/new" />}>
          새 챗봇 만들기
        </Button>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-muted-foreground">
              목록을 불러올 수 없습니다.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => refetch()}
            >
              다시 시도
            </Button>
          </div>
        ) : data && data.items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-muted-foreground">
              등록된 챗봇이 없습니다. 첫 챗봇을 만들어보세요.
            </p>
            <Button render={<Link href="/chatbots/new" />} variant="outline" size="sm" className="mt-3">
              새 챗봇 만들기
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead>chatbot_id</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>티어 수</TableHead>
                    <TableHead>최근 수정</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((config) => (
                    <TableRow
                      key={config.id}
                      className={
                        !config.is_active ? "text-muted-foreground" : ""
                      }
                    >
                      <TableCell className="font-medium">
                        {config.display_name}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {config.chatbot_id}
                      </TableCell>
                      <TableCell>
                        {config.is_active ? (
                          <Badge variant="default">활성</Badge>
                        ) : (
                          <Badge variant="secondary">비활성</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {config.search_tiers?.tiers?.length ?? 0}
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(config.updated_at).toLocaleDateString("ko-KR")}
                      </TableCell>
                      <TableCell>
                        <Button render={<Link href={`/chatbots/${config.id}/edit`} />} variant="ghost" size="sm">
                          편집
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  이전
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  다음
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
