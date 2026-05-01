"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { ChatButton } from "@/components/truewords";
import { cn } from "@/lib/utils";
import {
  EMPHASIS_OPTIONS,
  type TheologicalEmphasis,
} from "@/features/chat/types";

// W2-② P1-G — 강조점 5종 sheet (PersonaSheet 패턴 변형)
export interface EmphasisSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: TheologicalEmphasis;
  onValueChange: (value: TheologicalEmphasis) => void;
}

export function EmphasisSheet({
  open,
  onOpenChange,
  value,
  onValueChange,
}: EmphasisSheetProps) {
  const [draft, setDraft] = React.useState<TheologicalEmphasis>(value);

  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const handleApply = () => {
    onValueChange(draft);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] rounded-t-2xl"
        aria-label="강조점 선택"
      >
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="text-lg">강조점</SheetTitle>
          <SheetDescription>
            어떤 관점을 더 비중 있게 다룰까요?
          </SheetDescription>
        </SheetHeader>

        <div
          role="radiogroup"
          aria-label="강조점 5종"
          className="flex flex-col gap-1 px-3 overflow-y-auto"
        >
          {EMPHASIS_OPTIONS.map((opt) => {
            const active = draft === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDraft(opt.key)}
                className={cn(
                  "group flex items-start gap-3 rounded-xl border px-4 py-3 text-left",
                  "transition-all duration-200 ease-spring active:scale-[0.99]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-secondary",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {opt.label}
                    </span>
                    {opt.badge ? (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {opt.badge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground break-keep-all">
                    {opt.description}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-primary" : "border-border",
                  )}
                >
                  {active ? (
                    <span className="size-2.5 rounded-full bg-primary" />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <SheetFooter className="px-5 pt-3 pb-safe">
          <ChatButton
            onClick={handleApply}
            variant="brass"
            size="xl"
            fullWidth
          >
            적용하기
          </ChatButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export interface EmphasisRowTriggerProps {
  value: TheologicalEmphasis;
  onClick: () => void;
  label?: string;
}

/** 입력 화면에서 "강조점 — 전체 (균형) >" 행 */
export function EmphasisRowTrigger({
  value,
  onClick,
  label = "강조점",
}: EmphasisRowTriggerProps) {
  const opt =
    EMPHASIS_OPTIONS.find((o) => o.key === value) ?? EMPHASIS_OPTIONS[0];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3",
        "hover:bg-secondary transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="ml-auto flex items-center gap-1 text-sm font-medium text-foreground">
        {opt.label}
        {opt.badge ? (
          <span className="text-xs text-muted-foreground">({opt.badge})</span>
        ) : null}
        <span aria-hidden="true" className="text-fg-subtle">
          ›
        </span>
      </span>
    </button>
  );
}
