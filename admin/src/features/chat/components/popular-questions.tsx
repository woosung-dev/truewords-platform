"use client";

// P1-C — 동적 인기 질문 리스트.
// ADR-46 Screen 1 §C.1.2 — 입력 화면 SUGGESTED_PROMPTS 위에 "이번 주 인기"
// 5개를 표시. foundation 의 ScenarioGrid 가 미도입이어서 followup-pills 의
// pill 스타일을 차용한 가벼운 칩 그리드로 구성한다.

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import {
  fetchPopularQuestions,
  type PopularPeriod,
  type PopularQuestion,
} from "@/lib/popular-questions-api";
import { cn } from "@/lib/utils";

export interface PopularQuestionsProps {
  chatbotId: string;
  /** 인기 질문 클릭 시 (입력창 자동 채우기) */
  onSelect: (question: string) => void;
  /** 노출 갯수 (기본 5) */
  limit?: number;
  /** 집계 기간 (기본 7d) */
  period?: PopularPeriod;
  /** 헤더 라벨 (기본: "이번 주 인기") */
  heading?: string;
  className?: string;
}

const PERIOD_LABEL: Record<PopularPeriod, string> = {
  "7d": "이번 주 인기",
  "30d": "이번 달 인기",
};

export function PopularQuestions({
  chatbotId,
  onSelect,
  limit = 5,
  period = "7d",
  heading,
  className,
}: PopularQuestionsProps) {
  const [items, setItems] = useState<PopularQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!chatbotId) return;
    const controller = new AbortController();
    setLoading(true);
    setErrored(false);

    fetchPopularQuestions(chatbotId, {
      period,
      limit,
      signal: controller.signal,
    })
      .then((data) => {
        setItems(data);
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === "AbortError") return;
        setItems([]);
        setErrored(true);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [chatbotId, period, limit]);

  // 로딩 중에는 영역 자체를 표시하지 않는다 (스켈레톤 노이즈 방지).
  if (loading) return null;
  // 데이터가 없거나 에러면 정적 SUGGESTED_PROMPTS 만 보여주도록 빈 렌더.
  if (errored || items.length === 0) return null;

  const label = heading ?? PERIOD_LABEL[period];

  return (
    <section
      className={cn("flex flex-col gap-2", className)}
      aria-label={label}
    >
      <h3 className="flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <TrendingUp className="size-3.5" aria-hidden="true" />
        {label}
      </h3>

      <ul className="flex w-full flex-wrap justify-center gap-2">
        {items.map((it, idx) => (
          <li key={`${idx}-${it.question}`}>
            <button
              type="button"
              onClick={() => onSelect(it.question)}
              className="group flex items-center gap-1.5 rounded-full border bg-card px-4 py-2 text-xs text-foreground/80 transition hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
              aria-label={`${it.question} (${it.count}회 질문됨)`}
            >
              <span className="break-keep-all">{it.question}</span>
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground group-hover:bg-primary/10">
                {it.count}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
