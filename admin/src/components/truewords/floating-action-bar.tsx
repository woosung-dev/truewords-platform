"use client";

import * as React from "react";
import { Plus, Bookmark, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Plan B.5 + P0-G ★ — 답변 페이지 하단 floating action bar
export interface FloatingActionBarProps {
  onNewQuestion?: () => void;
  onBookmark?: () => void;
  onShare?: () => void;
  bookmarked?: boolean;
  className?: string;
}

export function FloatingActionBar({
  onNewQuestion,
  onBookmark,
  onShare,
  bookmarked = false,
  className,
}: FloatingActionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="답변 액션"
      className={cn(
        "fixed inset-x-4 bottom-4 z-30 mx-auto max-w-md",
        "rounded-full border border-border bg-card/85 backdrop-blur-lg",
        "shadow-(--tw-shadow-float)",
        "px-3 py-2",
        "pb-safe-offset",
        className
      )}
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px) + 0.5rem, 0.5rem)" }}
    >
      <div className="flex items-center justify-around gap-1">
        <FloatingButton
          icon={Plus}
          label="새 질문"
          onClick={onNewQuestion}
        />
        <span className="h-6 w-px bg-border" aria-hidden="true" />
        <FloatingButton
          icon={Bookmark}
          label={bookmarked ? "저장됨" : "북마크"}
          onClick={onBookmark}
          active={bookmarked}
        />
        <span className="h-6 w-px bg-border" aria-hidden="true" />
        <FloatingButton
          icon={Share2}
          label="공유"
          onClick={onShare}
        />
      </div>
    </div>
  );
}

interface FloatingButtonProps {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  active?: boolean;
}

function FloatingButton({
  icon: Icon,
  label,
  onClick,
  active,
}: FloatingButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5",
        "min-h-11 rounded-xl px-3 py-1.5",
        "text-[11px] font-medium tracking-tight",
        "transition-all duration-150 ease-out",
        "active:scale-[0.95] active:duration-75",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "text-accent"
          : "text-foreground hover:bg-secondary"
      )}
    >
      <Icon
        className="size-5"
        fill={active ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {label}
    </button>
  );
}
