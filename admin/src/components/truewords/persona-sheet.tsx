"use client";

import * as React from "react";
import {
  User,
  GraduationCap,
  HeartHandshake,
  Sparkles,
  Smile,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { ChatButton } from "./chat-button";
import { cn } from "@/lib/utils";

// Plan B.4 + P0-E ★★ — 답변 모드 페르소나 5종
export type PersonaMode =
  | "standard"
  | "theological"
  | "pastoral"
  | "beginner"
  | "kids";

interface PersonaDef {
  key: PersonaMode;
  icon: LucideIcon;
  label: string;
  description: string;
  /** 강조 라벨 (예: 추천 / 위급 자동) */
  badge?: string;
}

export const PERSONAS: PersonaDef[] = [
  {
    key: "standard",
    icon: User,
    label: "표준",
    description: "질문에 가장 알맞은 톤으로 답변",
    badge: "추천",
  },
  {
    key: "theological",
    icon: GraduationCap,
    label: "신학자",
    description: "원리·교리 깊이 있는 해설",
  },
  {
    key: "pastoral",
    icon: HeartHandshake,
    label: "목회 상담",
    description: "위로와 공감 중심 — 위급 키워드 자동 라우팅",
  },
  {
    key: "beginner",
    icon: Sparkles,
    label: "초신자",
    description: "쉬운 말로 짧고 친절하게",
  },
  {
    key: "kids",
    icon: Smile,
    label: "어린이",
    description: "유년부 눈높이 비유로 설명",
  },
];

export interface PersonaSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: PersonaMode;
  onValueChange: (value: PersonaMode) => void;
}

export function PersonaSheet({
  open,
  onOpenChange,
  value,
  onValueChange,
}: PersonaSheetProps) {
  const [draft, setDraft] = React.useState<PersonaMode>(value);

  // sheet 열릴 때 draft를 현재 value 로 동기화
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
        aria-label="답변 모드 선택"
      >
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="text-lg">답변 모드</SheetTitle>
          <SheetDescription>누가 답해주면 좋을까요?</SheetDescription>
        </SheetHeader>

        <div
          role="radiogroup"
          aria-label="답변 모드 5종"
          className="flex flex-col gap-1 px-3 overflow-y-auto"
        >
          {PERSONAS.map((p) => {
            const active = draft === p.key;
            const Icon = p.icon;
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDraft(p.key)}
                className={cn(
                  "group flex items-start gap-3 rounded-xl border px-4 py-3 text-left",
                  "transition-all duration-200 ease-spring active:scale-[0.99]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-secondary"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground"
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{p.label}</span>
                    {p.badge ? (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {p.badge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground break-keep-all">
                    {p.description}
                  </p>
                </div>
                {/* radio dot */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
                    active
                      ? "border-primary"
                      : "border-border"
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

export interface PersonaRowTriggerProps {
  value: PersonaMode;
  onClick: () => void;
  label?: string;
}

/** 입력 화면에서 "답변 모드 — 표준 (추천) >" 행 */
export function PersonaRowTrigger({
  value,
  onClick,
  label = "답변 모드",
}: PersonaRowTriggerProps) {
  const persona = PERSONAS.find((p) => p.key === value) ?? PERSONAS[0];
  const Icon = persona.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3",
        "hover:bg-secondary transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      )}
    >
      <Icon className="size-5 text-accent" aria-hidden="true" />
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="ml-auto flex items-center gap-1 text-sm font-medium text-foreground">
        {persona.label}
        {persona.badge ? (
          <span className="text-xs text-muted-foreground">({persona.badge})</span>
        ) : null}
        <span aria-hidden="true" className="text-fg-subtle">
          ›
        </span>
      </span>
    </button>
  );
}
