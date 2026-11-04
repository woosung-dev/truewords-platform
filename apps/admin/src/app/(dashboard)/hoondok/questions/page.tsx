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
import { isNotFound, loadErrorMessage, mutationErrorMessage } from "@/features/hoondok/api-errors";
import { kstTodayIso } from "@/features/hoondok/dates";
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

/**
 * 답 미리보기 — 관리자 앱에는 마크다운 렌더러가 없어(새 의존성 없이) 제목 줄과 **굵게**만 가볍게 처리한다.
 * 나머지 기호는 원문 그대로 둔다. HTML 로 해석하지 않고 React 텍스트로만 넣는다.
 */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: 한 줄 안에서 순서가 고정된 조각
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

function AnswerPreview({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
        if (heading) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 읽기 전용 원문의 줄 순서
            <p key={i} className="font-semibold pt-2 first:pt-0">
              {renderInline(heading[1])}
            </p>
          );
        }
        // 빈 줄은 단락 사이 여백으로 둔다
        // biome-ignore lint/suspicious/noArrayIndexKey: 읽기 전용 원문의 줄 순서
        if (line.trim() === "") return <div key={i} className="h-2" aria-hidden />;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 읽기 전용 원문의 줄 순서
          <p key={i} className="whitespace-pre-wrap">
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}

/** 추천 질문 고르기 — 식구가 공개를 허용한 질문·답(후보) 중 고른 것만 훈독 추천 목록에 익명으로 나간다. */
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
      toast.success(next === "published" ? "추천했습니다" : "추천에서 뺐습니다");
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
  // 뒤쪽 쪽의 마지막 항목을 추천하거나 빼면 그 쪽이 비고 쪽 넘김도 사라진다 — 남은 마지막 쪽으로 옮긴다
  if (data && items.length === 0 && page > 1) setPage(totalPages < page ? totalPages : page - 1);

  return (
    <div className="space-y-5 page-wide">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">추천 질문 고르기</h1>
        <p className="text-sm text-muted-foreground mt-1">
          식구님들이 공개를 허용한 질문과 답이에요. 추천한 것만 훈독 AI 질문의 추천 목록에 이름 없이 보여요.
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
                  <TableHead className="w-48" />
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
              추천하기
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
              추천에서 빼기
            </Button>
          )}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="bg-admin-muted/20 whitespace-normal">
            <section id={previewId} aria-label="답 미리보기" className="space-y-3 py-1">
              <p className="text-sm font-medium">{item.question}</p>
              <AnswerPreview text={item.answer_md} />
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
