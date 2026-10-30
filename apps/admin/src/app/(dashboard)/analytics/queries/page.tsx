"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { analyticsAPI } from "@/features/analytics/api";

import { TruncateTooltip } from "@/features/analytics/components/truncate-tooltip";
import type { QuerySortKey } from "@/features/analytics/types";

const QueryDetailModal = dynamic(() => import("@/features/analytics/components/query-detail-modal"));

const DAYS_OPTIONS = [7, 30, 90, 365];
const SORT_LABEL: Record<QuerySortKey, string> = {
  count_desc: "횟수 ↓",
  count_asc: "횟수 ↑",
  recent_desc: "최근 발생 ↓",
  recent_asc: "최근 발생 ↑",
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function QueriesExplorerPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const q = sp.get("q") ?? "";
  const days = Number(sp.get("days") ?? 30);
  const sort = (sp.get("sort") ?? "count_desc") as QuerySortKey;
  const page = Number(sp.get("page") ?? 1);
  const size = 50;

  const [selectedQuery, setSelectedQuery] = useState<{ query: string; open: boolean } | null>(null);
  const queryString = sp.toString();
  const updateParams = useCallback(
    (changes: Record<string, string | number>) => {
      const params = new URLSearchParams(queryString);
      for (const [k, v] of Object.entries(changes)) {
        if (v === "") params.delete(k);
        else params.set(k, String(v));
      }
      router.push(`/analytics/queries?${params.toString()}`);
    },
    [queryString, router],
  );
  const search = useCallback((value: string) => updateParams({ q: value, page: 1 }), [updateParams]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["queries", q, days, sort, page, size],
    queryFn: () => analyticsAPI.getQueries({ q, days, sort, page, size }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / size)) : 1;

  return (
    <div className="space-y-6 page-wide">
      {/* 헤더 */}
      <div>
        <nav className="flex items-center gap-1 text-xs">
          <Link href="/analytics" className="inline-flex items-center gap-1 text-primary hover:underline">
            <ChevronLeft className="h-3.5 w-3.5" />
            검색 분석
          </Link>
          <span className="text-muted-foreground">›</span>
          <span className="text-muted-foreground">질문 탐색</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight mt-2">질문 탐색</h1>
        <p className="text-sm text-muted-foreground mt-1">전체 질문을 검색·정렬하고 각 질문의 상세를 확인합니다</p>
      </div>

      {/* 필터 바 */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <QuerySearchInput key={q} query={q} onSearch={search} />
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">기간</span>
            <select
              value={days}
              onChange={(e) => updateParams({ days: Number(e.target.value), page: 1 })}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  최근 {d}일
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">정렬</span>
            <select
              value={sort}
              onChange={(e) => updateParams({ sort: e.target.value, page: 1 })}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {(Object.keys(SORT_LABEL) as QuerySortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        {isLoading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-muted-foreground">데이터를 불러오지 못했습니다</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">조건에 맞는 질문이 없습니다</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border" role="region" aria-label="질문 목록" tabIndex={0}>
            <p className="px-3 py-2 text-xs text-muted-foreground sm:hidden">
              표를 좌우로 밀어 전체 내용을 확인하세요.
            </p>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-admin-muted/50 border-b">
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground min-w-12 whitespace-nowrap">
                    순위
                  </th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">질문</th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground min-w-16 whitespace-nowrap">
                    횟수
                  </th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                    부정 피드백
                  </th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground min-w-36 whitespace-nowrap">
                    최근 발생
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, i) => {
                  const rank = (page - 1) * size + i + 1;
                  return (
                    <tr
                      key={`${item.query_text}-${i}`}
                      className={
                        (i !== 0 ? "border-t " : "") + "cursor-pointer hover:bg-admin-muted/40 transition-colors"
                      }
                      onClick={() => setSelectedQuery({ query: item.query_text, open: true })}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedQuery({ query: item.query_text, open: true });
                        }
                      }}
                      title="클릭하면 상세 정보를 확인할 수 있습니다"
                    >
                      <td className="py-2 px-3 text-muted-foreground font-mono text-xs whitespace-nowrap">{rank}</td>
                      <td className="py-2 px-3 max-w-0 w-full">
                        <TruncateTooltip text={item.query_text} />
                      </td>
                      <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                        {item.count.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {item.negative_feedback_count > 0 ? (
                          <span className="text-destructive font-medium">{item.negative_feedback_count}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(item.latest_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 페이지네이션 */}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              총 {data.total.toLocaleString()}건 · {size}개/페이지
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                aria-label="이전 페이지"
                disabled={page <= 1}
                onClick={() => updateParams({ page: page - 1 })}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-2 font-mono">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label="다음 페이지"
                disabled={page >= totalPages}
                onClick={() => updateParams({ page: page + 1 })}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 질문 상세 모달 (기존 재사용) */}
      {selectedQuery !== null && (
        <QueryDetailModal
          open={selectedQuery.open}
          onOpenChange={(open) => {
            setSelectedQuery((current) => (current ? { ...current, open } : null));
          }}
          queryText={selectedQuery.query}
          days={days}
        />
      )}
    </div>
  );
}

/** URL 검색어가 바뀌면 입력을 새로 열고, 필터 변경에는 진행 중 입력을 유지한다. */
function QuerySearchInput({ query, onSearch }: { query: string; onSearch: (value: string) => void }) {
  const [value, setValue] = useState(query);
  useEffect(() => {
    if (value === query) return;
    const timer = setTimeout(() => onSearch(value), 300);
    return () => clearTimeout(timer);
  }, [value, query, onSearch]);
  return (
    <input
      aria-label="질문 검색"
      type="text"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder="질문 검색..."
      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
    />
  );
}
