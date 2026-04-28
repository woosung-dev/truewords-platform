"use client";

import { Lightbulb, Lock, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatButton } from "./chat-button";

// Plan B.6 + P0-A 자동 follow-up + P2-K 부분 블러
export interface FollowupPillsProps {
  /** 추천 질문 배열 (보통 3~5개) */
  suggestions: string[];
  /** 비로그인 사용자 → 일정 갯수 이후 블러 (기본 2 — 1·2번만 노출) */
  visibleCount?: number;
  /** 로그인 여부 */
  authenticated?: boolean;
  /** 질문 클릭 시 */
  onSelect?: (question: string, index: number) => void;
  /** 카카오 로그인 (또는 다른 로그인 트리거) */
  onLoginClick?: () => void;
  className?: string;
  heading?: string;
}

export function FollowupPills({
  suggestions,
  visibleCount = 2,
  authenticated = false,
  onSelect,
  onLoginClick,
  className,
  heading = "다음 질문",
}: FollowupPillsProps) {
  if (suggestions.length === 0) return null;

  return (
    <section className={cn("space-y-3", className)} aria-label={heading}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
        <Lightbulb className="size-4 text-accent" aria-hidden="true" />
        {heading}
      </h3>

      <ul className="flex flex-col gap-2">
        {suggestions.map((q, idx) => {
          const blurred = !authenticated && idx >= visibleCount;
          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => !blurred && onSelect?.(q, idx)}
                aria-hidden={blurred ? true : undefined}
                tabIndex={blurred ? -1 : 0}
                disabled={blurred}
                className={cn(
                  "w-full rounded-full border border-border bg-card px-4 py-2.5",
                  "text-left text-sm text-foreground break-keep-all",
                  "transition-all duration-150 ease-out",
                  "active:scale-[0.98]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  !blurred &&
                    "hover:border-primary hover:bg-secondary cursor-pointer",
                  blurred &&
                    "select-none pointer-events-none [filter:blur(6px)] opacity-60"
                )}
              >
                {q}
              </button>
            </li>
          );
        })}
      </ul>

      {!authenticated && suggestions.length > visibleCount ? (
        <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-4 text-center">
          <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            로그인하면 더 많은 추천 질문을 볼 수 있어요
          </p>
          <ChatButton
            onClick={onLoginClick}
            variant="kakao"
            size="md"
            fullWidth
            className="mt-3"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            카카오 로그인
          </ChatButton>
        </div>
      ) : null}
    </section>
  );
}
