"use client";

import * as React from "react";
import { ThumbsUp, ThumbsDown, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";

// P1-A — 답변 평가 (👍 👎 💾)
export type FeedbackKind = "thumbs_up" | "thumbs_down" | "save";

export interface FeedbackButtonsProps {
  /** 현재 활성 상태 */
  state?: {
    thumbsUp?: boolean;
    thumbsDown?: boolean;
    saved?: boolean;
  };
  onFeedback?: (kind: FeedbackKind) => void;
  className?: string;
}

export function FeedbackButtons({
  state = {},
  onFeedback,
  className,
}: FeedbackButtonsProps) {
  return (
    <section
      aria-label="답변 평가"
      className={cn("space-y-2", className)}
    >
      <p className="text-sm text-muted-foreground">
        이 답변이 도움이 되었나요?
      </p>
      <div className="flex flex-wrap gap-2">
        <FeedbackButton
          icon={ThumbsUp}
          label="도움"
          active={state.thumbsUp}
          onClick={() => onFeedback?.("thumbs_up")}
        />
        <FeedbackButton
          icon={ThumbsDown}
          label="부적합"
          active={state.thumbsDown}
          onClick={() => onFeedback?.("thumbs_down")}
        />
        <FeedbackButton
          icon={Bookmark}
          label={state.saved ? "저장됨" : "저장"}
          active={state.saved}
          onClick={() => onFeedback?.("save")}
          fillWhenActive
        />
      </div>
    </section>
  );
}

interface FeedbackButtonProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  fillWhenActive?: boolean;
  onClick?: () => void;
}

function FeedbackButton({
  icon: Icon,
  label,
  active,
  fillWhenActive,
  onClick,
}: FeedbackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2",
        "text-sm font-medium transition-all duration-150 ease-out",
        "active:scale-[0.96] active:duration-75",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:bg-secondary"
      )}
    >
      <Icon
        className="size-4"
        fill={active && fillWhenActive ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {label}
    </button>
  );
}
