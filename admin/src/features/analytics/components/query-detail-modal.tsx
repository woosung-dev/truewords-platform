"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { analyticsAPI } from "@/features/analytics/api";
import QueryDetailOccurrence from "./query-detail-occurrence";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queryText: string | null;
  days?: number;
}

export default function QueryDetailModal({
  open,
  onOpenChange,
  queryText,
  days = 30,
}: Props) {
  const enabled = open && !!queryText;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["query-details", queryText, days],
    queryFn: () => analyticsAPI.getQueryDetails(queryText!, days),
    enabled,
    staleTime: 30_000,
  });

  // 모달이 다시 열릴 때 펼침 상태 초기화
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  useEffect(() => {
    if (open && data) {
      setExpanded({ 0: true }); // 첫 발생만 기본 펼침
    }
  }, [open, data]);

  const toggle = (i: number) =>
    setExpanded((prev) => ({ ...prev, [i]: !prev[i] }));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-0 z-50 m-auto flex h-fit max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-popover shadow-2xl transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95">
          {/* 헤더 */}
          <div className="flex items-start justify-between border-b px-6 py-4 gap-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold line-clamp-2 break-words">
                {queryText ?? "질문 상세"}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-1">
                {data
                  ? `총 ${data.total_count}건 발생 · 최근 ${data.days}일` +
                    (data.total_count > data.returned_count
                      ? ` (상위 ${data.returned_count}건만 표시)`
                      : "")
                  : "불러오는 중..."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1 text-muted-foreground hover:bg-admin-muted hover:text-foreground transition-colors shrink-0">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* 본문 */}
          <div className="overflow-y-auto px-6 py-4 space-y-3">
            {isLoading && (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center gap-3 py-10">
                <p className="text-sm text-muted-foreground">
                  상세 정보를 불러오지 못했습니다
                </p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  다시 시도
                </Button>
              </div>
            )}

            {!isLoading && !isError && data && data.occurrences.length === 0 && (
              <p className="text-sm text-muted-foreground py-10 text-center">
                최근 {days}일 내 발생이 없습니다
              </p>
            )}

            {!isLoading &&
              !isError &&
              data &&
              data.occurrences.map((occ, i) => (
                <QueryDetailOccurrence
                  key={occ.search_event_id}
                  index={i}
                  occurrence={occ}
                  expanded={!!expanded[i]}
                  onToggle={() => toggle(i)}
                />
              ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
