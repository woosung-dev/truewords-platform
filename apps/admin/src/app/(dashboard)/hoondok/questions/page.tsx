"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { kstTodayIso } from "@/features/hoondok/dates";
import { isNotFound, loadErrorMessage, mutationErrorMessage } from "@/features/hoondok/groups-api";
import {
  ANSWER_MODE_LABEL,
  type PublicQuestionAdminItem,
  QUESTION_STATUS_LABEL,
  type QuestionReviewStatus,
  type QuestionStatus,
  questionsAPI,
} from "@/features/hoondok/questions-api";

const LIST_KEY = ["hoondok", "questions"];

// 상태 배지 — 카드 화면의 검수 배지 토큰을 그대로 쓴다(새 디자인 없음).
const STATUS_BADGE: Record<QuestionStatus, string> = {
  pending: "bg-transparent text-muted-foreground hover:bg-transparent border border-dashed border-border",
  published: "bg-success-soft text-success hover:bg-success-soft border border-success-border",
  hidden: "bg-admin-muted text-muted-foreground hover:bg-admin-muted border border-border",
};

const FILTERS: QuestionStatus[] = ["pending", "published", "hidden"];

/** 신청일은 KST 날짜로 보인다. */
function kstDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : kstTodayIso(date);
}

/** 사용자가 공개를 신청한 질문·답 검수. 공개한 것만 훈독 질문 목록에 익명으로 나간다. */
export default function HoondokQuestionsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<QuestionStatus>("pending");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...LIST_KEY, status, page],
    queryFn: () => questionsAPI.list(status, page),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: LIST_KEY });

  const reviewMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: QuestionReviewStatus }) => questionsAPI.review(id, next),
    onSuccess: (_, { next }) => {
      toast.success(next === "published" ? "공개했습니다" : "숨겼습니다");
      refresh();
    },
    onError: (err: Error) => {
      toast.error(mutationErrorMessage(err, "저장에 실패했습니다"));
      if (isNotFound(err)) refresh();
    },
  });

  function changeFilter(next: QuestionStatus) {
    setStatus(next);
    setPage(1);
    setOpenId(null);
  }

  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const busy = reviewMutation.isPending;
  // 뒤쪽 쪽의 마지막 항목을 공개·숨김하면 그 쪽이 비고 쪽 넘김도 사라진다 — 남은 마지막 쪽으로 옮긴다
  if (data && items.length === 0 && page > 1) setPage(totalPages < page ? totalPages : page - 1);

  return (
    <div className="space-y-5 page-wide">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">공개 질문 검수</h1>
        <p className="text-sm text-muted-foreground mt-1">
          사용자가 공개를 신청한 질문과 답이에요. 공개한 것만 훈독 질문 목록에 이름 없이 보여요.
        </p>
      </div>

      <div role="group" aria-label="상태 필터" className="flex flex-wrap gap-1.5">
        {FILTERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? "default" : "outline"}
            aria-pressed={status === value}
            onClick={() => changeFilter(value)}
          >
            {QUESTION_STATUS_LABEL[value]}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <Card className="p-0 overflow-hidden">
          {["s1", "s2", "s3", "s4", "s5"].map((key, i) => (
            <div key={key} className={`px-5 py-4 ${i !== 0 ? "border-t" : ""}`}>
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </Card>
      ) : isError ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <p className="text-muted-foreground text-sm">{loadErrorMessage(error, "질문 목록을 불러올 수 없습니다.")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-muted-foreground text-sm">이 상태의 질문이 없습니다.</p>
        </div>
      ) : (
        <>
          <Card className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-admin-muted/40 hover:bg-admin-muted/40">
                  <TableHead className="font-semibold text-foreground">신청일</TableHead>
                  <TableHead className="font-semibold text-foreground">질문</TableHead>
                  <TableHead className="font-semibold text-foreground">답변 모델</TableHead>
                  <TableHead className="font-semibold text-foreground">근거</TableHead>
                  <TableHead className="font-semibold text-foreground">상태</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <QuestionRow
                    key={item.id}
                    item={item}
                    open={openId === item.id}
                    onToggle={() => setOpenId((prev) => (prev === item.id ? null : item.id))}
                    busy={busy}
                    onReview={(next) => reviewMutation.mutate({ id: item.id, next })}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>

          <nav aria-label="페이지" className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              총 {data?.total ?? 0}건 · {page} / {totalPages}쪽
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                이전
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                다음
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

interface QuestionRowProps {
  item: PublicQuestionAdminItem;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onReview: (next: QuestionReviewStatus) => void;
}

function QuestionRow({ item, open, onToggle, busy, onReview }: QuestionRowProps) {
  const previewId = `question-preview-${item.id}`;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Fragment>
      <TableRow data-id={item.id} className="hover:bg-admin-muted/30 transition-colors align-top">
        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{kstDate(item.created_at)}</TableCell>
        <TableCell className="min-w-[16rem] max-w-[32rem] whitespace-normal">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={previewId}
            onClick={onToggle}
            className="flex items-start gap-1.5 text-left text-sm leading-relaxed hover:underline"
          >
            <Chevron className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="line-clamp-2">{item.question}</span>
          </button>
        </TableCell>
        <TableCell className="whitespace-nowrap text-sm">{ANSWER_MODE_LABEL[item.answer_mode]}</TableCell>
        <TableCell className="text-sm tabular-nums">{item.sources.length}</TableCell>
        <TableCell>
          <Badge className={STATUS_BADGE[item.status]}>{QUESTION_STATUS_LABEL[item.status]}</Badge>
        </TableCell>
        <TableCell className="text-right whitespace-nowrap space-x-1.5">
          {item.status !== "published" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview("published")}>
              공개
            </Button>
          )}
          {item.status !== "hidden" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => onReview("hidden")}
            >
              숨김
            </Button>
          )}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="bg-admin-muted/20 whitespace-normal">
            <section id={previewId} aria-label="답 미리보기" className="space-y-3 py-1">
              <p className="text-sm font-medium">{item.question}</p>
              {/* 관리자 앱에는 마크다운 렌더러가 없어 원문 그대로 보여 준다. */}
              <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer_md}</p>
              {item.sources.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-medium text-muted-foreground">근거 {item.sources.length}건</h3>
                  <ul className="space-y-1.5">
                    {item.sources.map((source, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 순서가 바뀌지 않는 읽기 전용 목록
                      <li key={i} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{source.volume || source.source}</span>
                        <span className="line-clamp-2">{source.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
