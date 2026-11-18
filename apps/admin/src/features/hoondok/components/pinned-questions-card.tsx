"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, PinOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isNotFound, loadErrorMessage, mutationErrorMessage } from "@/features/hoondok/api-errors";
import {
  MAX_PINNED,
  type PublicQuestionAdminItem,
  type PublicQuestionPinsResponse,
  questionsAPI,
} from "@/features/hoondok/questions-api";

export const QUESTIONS_KEY = ["hoondok", "questions"] as const;
export const PINS_KEY = [...QUESTIONS_KEY, "pins"] as const;

/** 버튼 이름에 쓰는 질문 앞 20자. */
export function shortQuestion(text: string): string {
  const chars = Array.from(text);
  return chars.length > 20 ? `${chars.slice(0, 20).join("")}…` : text;
}

type Dir = "up" | "down";

/** 추천 상단 고정 카드 — 고정 목록을 보이고, ▲▼ 로 순서를 바꾸며, 해제한다. */
export function PinnedQuestionsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: PINS_KEY,
    queryFn: () => questionsAPI.pins(),
  });
  const items = useMemo(() => data?.items ?? [], [data]);
  const full = items.length >= MAX_PINNED;
  const [announce, setAnnounce] = useState("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ id: string; dir: Dir } | null>(null);

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });

  const reorder = useMutation({
    mutationFn: ({ ids }: { ids: string[]; id: string; position: number }) => questionsAPI.reorderPins(ids),
    onMutate: async ({ ids }) => {
      await queryClient.cancelQueries({ queryKey: PINS_KEY });
      const previous = queryClient.getQueryData<PublicQuestionPinsResponse>(PINS_KEY);
      if (previous) {
        const byId = new Map(previous.items.map((item) => [item.id, item]));
        const next = ids.map((id) => byId.get(id)).filter((item): item is PublicQuestionAdminItem => !!item);
        queryClient.setQueryData<PublicQuestionPinsResponse>(PINS_KEY, { items: next });
      }
      return { previous };
    },
    onSuccess: (response, { id, position }) => {
      queryClient.setQueryData(PINS_KEY, response);
      const moved = response.items.find((item) => item.id === id);
      setAnnounce(`'${shortQuestion(moved?.question ?? "")}'을 ${position}번째로 옮겼습니다`);
      invalidateAll();
    },
    onError: (err: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(PINS_KEY, context.previous);
      setAnnounce("");
      toast.error("순서를 바꾸지 못했습니다. 원래 순서로 돌렸습니다");
      if (isNotFound(err)) invalidateAll();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PINS_KEY });
    },
  });

  const unpin = useMutation({
    mutationFn: (id: string) => questionsAPI.update(id, { pinned: false }),
    onSuccess: () => {
      toast.success("고정을 풀었습니다");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(isNotFound(err) ? mutationErrorMessage(err, "") : "고정을 풀지 못했습니다");
      if (isNotFound(err)) invalidateAll();
    },
  });

  function move(index: number, dir: Dir) {
    const target = dir === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;
    const ids = items.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    pendingFocus.current = { id: items[index].id, dir };
    reorder.mutate({ ids, id: items[index].id, position: target + 1 });
  }

  // 저장이 끝나면 누른 버튼으로 포커스를 돌린다. 맨 위·맨 아래에 닿아 비활성이면 반대 방향 버튼으로 옮긴다.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || reorder.isPending) return;
    pendingFocus.current = null;
    const index = items.findIndex((item) => item.id === target.id);
    if (index < 0) return;
    const disabled = target.dir === "up" ? index === 0 : index === items.length - 1;
    const dir: Dir = disabled ? (target.dir === "up" ? "down" : "up") : target.dir;
    buttons.current.get(`${target.id}:${dir}`)?.focus();
  }, [reorder.isPending, items]);

  const saving = reorder.isPending;

  return (
    <section aria-labelledby="pinned-title">
      <Card className="p-0 overflow-hidden gap-0">
        <div className="px-5 py-4 border-b space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="pinned-title" className="text-base font-semibold">
              추천 상단 고정
            </h2>
            <span className="text-sm text-muted-foreground tabular-nums">
              {items.length}/{MAX_PINNED}
            </span>
            {full && <StatusBadge tone="warning">가득 참</StatusBadge>}
          </div>
          <p className="text-sm text-muted-foreground">훈독 추천 목록 맨 위에 이 순서로 보여요.</p>
          {full && (
            <p id="pin-limit-note" className="text-xs text-warning">
              상단 고정은 10개까지예요. 하나를 해제해야 새로 고정할 수 있어요.
            </p>
          )}
        </div>

        <p className="sr-only" aria-live="polite" role="status">
          {announce}
        </p>

        {isLoading ? (
          <div className="px-5 py-3 space-y-3" aria-busy="true">
            {["p1", "p2", "p3"].map((key) => (
              <Skeleton key={key} className="h-5 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-5 text-center space-y-3">
            <p className="text-sm text-muted-foreground">{loadErrorMessage(error, "고정 목록을 불러올 수 없습니다.")}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed m-5 p-6 text-center text-sm text-muted-foreground">
            고정한 질문이 없어요. 아래 표에서 &apos;추천 중&apos;인 질문의 고정을 누르면 훈독 추천 목록 맨 위에 보여요.
          </div>
        ) : (
          <ol>
            {items.map((item, index) => {
              const name = shortQuestion(item.question);
              return (
                <li key={item.id} className={`flex flex-wrap items-start gap-3 px-5 py-3 ${index > 0 ? "border-t" : ""}`}>
                  <span className="w-6 text-sm text-muted-foreground tabular-nums pt-1.5">{index + 1}</span>
                  <p className="flex-1 min-w-[12rem] text-sm line-clamp-2 pt-1.5">{item.question}</p>
                  <span className="hidden sm:block text-xs text-muted-foreground tabular-nums whitespace-nowrap pt-2">
                    조회 {item.view_count.toLocaleString("ko-KR")} · 나도 {item.ask_count.toLocaleString("ko-KR")}
                  </span>
                  <div className="flex items-center gap-2 shrink-0 max-sm:w-full max-sm:justify-end">
                    <Button
                      ref={(el: HTMLButtonElement | null) => {
                        if (el) buttons.current.set(`${item.id}:up`, el);
                        else buttons.current.delete(`${item.id}:up`);
                      }}
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${index + 1}번 '${name}' 위로 이동`}
                      disabled={index === 0 || saving}
                      onClick={() => move(index, "up")}
                    >
                      <ChevronUp aria-hidden />
                    </Button>
                    <Button
                      ref={(el: HTMLButtonElement | null) => {
                        if (el) buttons.current.set(`${item.id}:down`, el);
                        else buttons.current.delete(`${item.id}:down`);
                      }}
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${index + 1}번 '${name}' 아래로 이동`}
                      disabled={index === items.length - 1 || saving}
                      onClick={() => move(index, "down")}
                    >
                      <ChevronDown aria-hidden />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`'${name}' 고정 해제`}
                      disabled={saving || unpin.isPending}
                      onClick={() => unpin.mutate(item.id)}
                    >
                      <PinOff aria-hidden /> 해제
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </section>
  );
}
