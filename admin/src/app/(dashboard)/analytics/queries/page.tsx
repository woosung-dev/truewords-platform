"use client";

// Next 16 production build 에서 useSearchParams 를 호출하는 client 컴포넌트가 Suspense
// 경계 없이 직접 export 되면 prerender 실패한다. 따라서 default export 는 Suspense
// wrapper 만 담고, 실제 hook 사용 본체는 child 컴포넌트로 분리한다.

import { Suspense, useEffect, useState, useTransition } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { analyticsAPI } from "@/features/analytics/api";
import { analyticsKeys } from "@/features/analytics/keys";
import type { QuerySortKey } from "@/features/analytics/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TruncateTooltip } from "@/features/analytics/components/truncate-tooltip";
import QueryDetailModal from "@/features/analytics/components/query-detail-modal";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";

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

function PageFallback() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-40 mt-2" />
      </div>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="rounded-xl border bg-card p-5 space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

function QueriesExplorerContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const q = sp.get("q") ?? "";
  const days = Number(sp.get("days") ?? 30);
  const sort = (sp.get("sort") ?? "count_desc") as QuerySortKey;
  const page = Number(sp.get("page") ?? 1);
  const size = 50;

  const [searchInput, setSearchInput] = useState(q);
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);

  // URL 의 q 가 외부 변경 (브라우저 뒤로가기 등) 시 입력창 동기화.
  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  const updateParams = (changes: Record<string, string | number>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === "" || v === undefined || v === null) {
        params.delete(k);
      } else {
        params.set(k, String(v));
      }
    }
    // 입력 중 URL push 가 urgent update 로 잡히면 렌더 압박이 큼.
    // transition 으로 표시해 React 가 input 입력 응답성을 우선시하게 한다.
    startTransition(() => {
      router.push(`/analytics/queries?${params.toString()}`);
    });
  };

  // debounce 된 입력값이 URL 의 q 와 다르면 URL 갱신.
  useEffect(() => {
    if (debouncedSearch !== q) {
      updateParams({ q: debouncedSearch, page: 1 });
    }
    // updateParams 는 매 렌더 새 클로저지만 debounce 값 + q 변화만이 트리거 의도.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: analyticsKeys.queries(q, days, sort, page, size),
    queryFn: () => analyticsAPI.getQueries({ q, days, sort, page, size }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / size)) : 1;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* 헤더 */}
      <div>
        <nav className="flex items-center gap-1 text-xs">
          <Link
            href="/analytics"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            검색 분석
          </Link>
          <span className="text-muted-foreground">›</span>
          <span className="text-muted-foreground">질문 탐색</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight mt-2">질문 탐색</h1>
        <p className="text-sm text-muted-foreground mt-1">
          전체 질문을 검색·정렬하고 각 질문의 상세를 확인합니다
        </p>
      </div>

      {/* 필터 바 */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="질문 검색..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">기간</span>
            <select
              value={days}
              onChange={(e) =>
                updateParams({ days: Number(e.target.value), page: 1 })
              }
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
              onChange={(e) =>
                updateParams({ sort: e.target.value, page: 1 })
              }
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
            <p className="text-sm text-muted-foreground">
              데이터를 불러오지 못했습니다
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">
            조건에 맞는 질문이 없습니다
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-admin-muted/50 border-b">
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground w-10">
                    순위
                  </th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">
                    질문
                  </th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-16">
                    횟수
                  </th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-14">
                    👎
                  </th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-36">
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
                        (i !== 0 ? "border-t " : "") +
                        "cursor-pointer hover:bg-admin-muted/40 transition-colors"
                      }
                      onClick={() => setSelectedQuery(item.query_text)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedQuery(item.query_text);
                        }
                      }}
                      title="클릭하면 상세 정보를 확인할 수 있습니다"
                    >
                      <td className="py-2 px-3 text-muted-foreground font-mono text-xs">
                        {rank}
                      </td>
                      <td className="py-2 px-3 max-w-0 w-full">
                        <TruncateTooltip text={item.query_text} />
                      </td>
                      <td className="py-2 px-3 text-right font-medium">
                        {item.count.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {item.negative_feedback_count > 0 ? (
                          <span className="text-destructive font-medium">
                            {item.negative_feedback_count}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-xs text-muted-foreground">
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
      <QueryDetailModal
        open={selectedQuery !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedQuery(null);
        }}
        queryText={selectedQuery}
        days={days}
      />
    </div>
  );
}

export default function QueriesExplorerPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <QueriesExplorerContent />
    </Suspense>
  );
}
