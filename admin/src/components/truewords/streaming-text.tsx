"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Plan B.8 — 스트리밍 답변 + skeleton + cursor
export interface StreamingTextProps {
  /** 최종 텍스트 — 토큰 단위로 점진 노출 */
  text: string;
  /** 스트리밍 중 여부 */
  streaming?: boolean;
  /** 토큰당 노출 간격 ms (기본 35) */
  intervalMs?: number;
  className?: string;
  /** prefers-reduced-motion 사용자에겐 즉시 전체 노출 */
}

export function StreamingText({
  text,
  streaming = false,
  intervalMs = 35,
  className,
}: StreamingTextProps) {
  const [shown, setShown] = React.useState(streaming ? "" : text);
  const reducedMotion = useReducedMotion();

  React.useEffect(() => {
    if (!streaming || reducedMotion) {
      setShown(text);
      return;
    }
    if (shown === text) return;

    let i = shown.length;
    const id = window.setInterval(() => {
      i += 1;
      if (i >= text.length) {
        setShown(text);
        window.clearInterval(id);
      } else {
        setShown(text.slice(0, i));
      }
    }, intervalMs);

    return () => window.clearInterval(id);
    // shown은 deps에 넣지 않음 — 의도적으로 한 사이클로 진행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, streaming, intervalMs, reducedMotion]);

  return (
    <span
      className={cn(
        "whitespace-pre-wrap break-keep-all",
        streaming && shown !== text && "tw-streaming-cursor",
        className
      )}
      aria-live={streaming ? "polite" : undefined}
      aria-busy={streaming && shown !== text ? "true" : undefined}
    >
      {shown}
    </span>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

export interface AnswerSkeletonProps {
  lines?: number;
  className?: string;
}

export function AnswerSkeleton({ lines = 3, className }: AnswerSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="답변을 준비하고 있어요"
      className={cn("flex flex-col gap-3", className)}
    >
      {Array.from({ length: lines }).map((_, idx) => (
        <div
          key={idx}
          className={cn(
            "h-3 overflow-hidden rounded-full bg-secondary",
            "relative isolate"
          )}
          style={{ width: `${100 - idx * 12}%` }}
        >
          <span
            className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-card/80 to-transparent animate-shimmer motion-reduce:hidden"
            aria-hidden="true"
          />
        </div>
      ))}
      <span className="sr-only">답변 생성 중</span>
    </div>
  );
}
