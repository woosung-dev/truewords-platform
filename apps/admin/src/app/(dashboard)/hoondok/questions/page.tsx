"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pin, PinOff } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isNotFound, loadErrorMessage, mutationErrorMessage } from "@/features/hoondok/api-errors";
import { PINS_KEY, PinnedQuestionsCard, QUESTIONS_KEY, shortQuestion } from "@/features/hoondok/components/pinned-questions-card";
import { kstTodayIso } from "@/features/hoondok/dates";
import {
  ANSWER_MODE_LABEL,
  MAX_PINNED,
  type PublicQuestionAdminItem,
  QUESTION_SEARCH_MAX,
  QUESTION_SORT_LABEL,
  QUESTION_STATUS_LABEL,
  type QuestionPatch,
  type QuestionSort,
  type QuestionStatus,
  questionsAPI,
} from "@/features/hoondok/questions-api";
import { ApiError } from "@/lib/api";

const LIST_KEY = [...QUESTIONS_KEY, "list"];
const SORTS = Object.keys(QUESTION_SORT_LABEL) as QuestionSort[];
const LIMIT_MESSAGE_SHORT = "상단 고정은 10개까지예요. 하나를 해제해야 새로 고정할 수 있어요.";
const LIMIT_MESSAGE = "상단 고정은 10개까지예요. 하나를 해제하고 다시 시도해 주세요.";
const nf = (n: number) => n.toLocaleString("ko-KR");

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
  const [sort, setSort] = useState<QuestionSort>("oldest");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  // 검색어는 300ms 멈춘 뒤 적용하고 1쪽부터 다시 본다
  useEffect(() => {
    const term = searchInput.trim();
    if (term === q) return;
    const timer = setTimeout(() => {
      setQ(term);
      setPage(1);
      setOpenId(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, q]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...LIST_KEY, status, sort, q, page],
    queryFn: () => questionsAPI.list({ status, sort, q, page }),
    placeholderData: keepPreviousData,
  });
  const pins = useQuery({ queryKey: PINS_KEY, queryFn: () => questionsAPI.pins() });
  const pinCount = pins.data?.items.length ?? 0;
  const pinLimitReached = pinCount >= MAX_PINNED;

  // 고정 카드와 표를 함께 갱신한다
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: QuestionPatch; wasPinned: boolean; pinCount: number }) =>
      questionsAPI.update(id, patch),
    onSuccess: (_, { patch, wasPinned, pinCount: count }) => {
      if (patch.pinned === true) toast.success(`상단에 고정했습니다 (${count + 1}/${MAX_PINNED})`);
      else if (patch.pinned === false) toast.success("고정을 풀었습니다");
      else if (patch.status === "published") toast.success("추천했습니다");
      else toast.success(wasPinned ? "추천에서 뺐습니다. 상단 고정도 풀렸습니다" : "추천에서 뺐습니다");
      refresh();
    },
    onError: (err: Error, { patch }) => {
      if (patch.pinned === true) {
        toast.error(err instanceof ApiError && err.status === 409 ? LIMIT_MESSAGE : "고정하지 못했습니다");
      } else if (patch.pinned === false) {
        toast.error("고정을 풀지 못했습니다");
      } else {
        toast.error(mutationErrorMessage(err, "저장에 실패했습니다"));
      }
      // 404 는 이미 없어진 질문, 409 는 고정 목록이 어긋난 경우라 둘 다 새로 고친다
      if (isNotFound(err) || (err instanceof ApiError && err.status === 409)) refresh();
    },
  });

  function changeFilter(next: QuestionStatus) {
    setStatus(next);
    setPage(1);
    setOpenId(null);
  }

  function clearSearch() {
    setSearchInput("");
    setQ("");
    setPage(1);
  }

  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const busy = patchMutation.isPending;
  // 뒤쪽 쪽의 마지막 항목을 추천하거나 빼면 그 쪽이 비고 쪽 넘김도 사라진다 — 남은 마지막 쪽으로 옮긴다
  if (data && !isLoading && items.length === 0 && page > 1) setPage(totalPages < page ? totalPages : page - 1);

  return (
    <div className="space-y-5 page-wide">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">추천 질문 고르기</h1>
        <p className="text-sm text-muted-foreground mt-1">
          식구님들이 공개를 허용한 질문과 답이에요. 추천한 것만 훈독 AI 질문의 추천 목록에 이름 없이 보여요. 추천 목록은
          상단 고정 → 점수(조회 + 나도 물어보기 × 3) 순이에요.
        </p>
      </div>

      <PinnedQuestionsCard />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
        <div className="flex gap-2 w-full md:w-auto">
          <div className="flex-1 md:flex-none md:w-40">
            <Label htmlFor="question-sort" className="sr-only">
              정렬
            </Label>
            <NativeSelect
              id="question-sort"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as QuestionSort);
                setPage(1);
              }}
            >
              {SORTS.map((value) => (
                <option key={value} value={value}>
                  {QUESTION_SORT_LABEL[value]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex-1 md:flex-none md:w-64">
            <Label htmlFor="question-search" className="sr-only">
              질문 검색
            </Label>
            <Input
              id="question-search"
              type="search"
              placeholder="질문 검색"
              maxLength={QUESTION_SEARCH_MAX}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>
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
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          {q ? (
            <>
              <p className="text-muted-foreground text-sm">&apos;{q}&apos;와 맞는 질문이 없습니다.</p>
              <Button variant="outline" size="sm" onClick={clearSearch}>
                검색 지우기
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">이 상태의 질문이 없습니다.</p>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">점수 = 조회 + 나도 물어보기 × 3</p>
          <Card className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-admin-muted/40 hover:bg-admin-muted/40">
                  <TableHead className="font-semibold text-foreground">질문</TableHead>
                  <TableHead className="font-semibold text-foreground hidden md:table-cell">답한 모델</TableHead>
                  <TableHead className="font-semibold text-foreground">상태</TableHead>
                  <TableHead className="font-semibold text-foreground text-right hidden lg:table-cell">조회</TableHead>
                  <TableHead className="font-semibold text-foreground text-right hidden lg:table-cell">
                    나도 물어보기
                  </TableHead>
                  <TableHead
                    aria-sort={sort === "popular" ? "descending" : undefined}
                    className="font-semibold text-foreground text-right"
                  >
                    점수
                  </TableHead>
                  <TableHead
                    aria-sort={sort === "newest" ? "descending" : sort === "oldest" ? "ascending" : undefined}
                    className="font-semibold text-foreground hidden md:table-cell"
                  >
                    신청일
                  </TableHead>
                  <TableHead className="text-right font-semibold text-foreground">동작</TableHead>
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
                    pinLimitReached={pinLimitReached}
                    onPatch={(patch) =>
                      patchMutation.mutate({ id: item.id, patch, wasPinned: item.pin_order !== null, pinCount })
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </Card>

          <nav aria-label="페이지" className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              총 {nf(data?.total ?? 0)}건 · {page} / {totalPages}쪽
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
  pinLimitReached: boolean;
  onPatch: (patch: QuestionPatch) => void;
}

function QuestionRow({ item, open, onToggle, busy, pinLimitReached, onPatch }: QuestionRowProps) {
  const previewId = `question-preview-${item.id}`;
  const Chevron = open ? ChevronDown : ChevronRight;
  const pinned = item.pin_order !== null;
  return (
    <Fragment>
      <TableRow data-id={item.id} className="hover:bg-admin-muted/30 transition-colors align-top">
        <TableCell className="min-w-[14rem] max-w-[32rem] whitespace-normal">
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
          {pinned && (
            <p className="mt-1 ml-5.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Pin className="w-3 h-3" aria-hidden /> 고정 {item.pin_order}번
            </p>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-sm hidden md:table-cell">
          {ANSWER_MODE_LABEL[item.answer_mode]}
        </TableCell>
        <TableCell>
          <Badge className={STATUS_BADGE[item.status]}>{QUESTION_STATUS_LABEL[item.status]}</Badge>
        </TableCell>
        <TableCell className="w-16 text-right text-sm tabular-nums hidden lg:table-cell">{nf(item.view_count)}</TableCell>
        <TableCell className="w-24 text-right text-sm tabular-nums hidden lg:table-cell">{nf(item.ask_count)}</TableCell>
        <TableCell className="w-16 text-right text-sm tabular-nums font-medium">{nf(item.score)}</TableCell>
        <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground hidden md:table-cell">
          {kstDate(item.created_at)}
        </TableCell>
        <TableCell className="whitespace-normal">
          <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
            {item.status !== "published" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onPatch({ status: "published" })}>
                추천하기
              </Button>
            )}
            {item.status !== "hidden" && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => onPatch({ status: "hidden" })}
              >
                추천에서 빼기
              </Button>
            )}
            {item.status === "published" &&
              (pinned ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onPatch({ pinned: false })}>
                  <PinOff aria-hidden /> 고정 해제
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || pinLimitReached}
                  aria-describedby={pinLimitReached ? "pin-limit-note" : undefined}
                  title={pinLimitReached ? LIMIT_MESSAGE_SHORT : undefined}
                  aria-label={`'${shortQuestion(item.question)}' 상단 고정`}
                  onClick={() => onPatch({ pinned: true })}
                >
                  <Pin aria-hidden /> 고정
                </Button>
              ))}
          </div>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="bg-admin-muted/20 whitespace-normal">
            <section id={previewId} aria-label="답 미리보기" className="space-y-3 py-1">
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground lg:hidden">
                <div className="flex gap-1 md:hidden">
                  <dt>답한 모델</dt>
                  <dd className="text-foreground">{ANSWER_MODE_LABEL[item.answer_mode]}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>조회</dt>
                  <dd className="text-foreground tabular-nums">{nf(item.view_count)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>나도 물어보기</dt>
                  <dd className="text-foreground tabular-nums">{nf(item.ask_count)}</dd>
                </div>
                <div className="flex gap-1 md:hidden">
                  <dt>신청일</dt>
                  <dd className="text-foreground tabular-nums">{kstDate(item.created_at)}</dd>
                </div>
              </dl>
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
