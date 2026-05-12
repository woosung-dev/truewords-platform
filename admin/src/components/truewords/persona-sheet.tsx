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
import { ChatButton } from "./chat-button";
import { cn } from "@/lib/utils";

// Plan B.4 + P0-E ★★ — 답변 모드 페르소나 5종
export type PersonaMode =
  | "standard"
  | "theological"
  | "pastoral"
  | "beginner"
  | "kids";

// 커스텀 SVG 아이콘 — 따뜻한 갈색 톤 (48×48 viewport)
export type PersonaIconProps = { size?: number };

const PersonaIconStandard = ({ size = 32 }: PersonaIconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M9 42c0-9 6-14 15-14s15 5 15 14z" fill="#D4B58A"/>
    <circle cx="24" cy="17" r="8" fill="#7A4A1D"/>
  </svg>
);

const PersonaIconTheological = ({ size = 32 }: PersonaIconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M14 23v9c0 3 4 5 10 5s10-2 10-5v-9z" fill="#D4B58A"/>
    <path d="M4 19l20-8 20 8-20 8z" fill="#7A4A1D"/>
    <path d="M40 19v11" stroke="#7A4A1D" strokeWidth="1.8" strokeLinecap="round"/>
    <circle cx="40" cy="32" r="1.6" fill="#7A4A1D"/>
  </svg>
);

const PersonaIconPastoral = ({ size = 32 }: PersonaIconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M9 27c0 9 7 14 15 14s15-5 15-14c-2 5-8 8-15 8s-13-3-15-8z" fill="#D4B58A"/>
    <path d="M24 28c-2-1-9-6-9-13 0-3 2-5 5-5 1.5 0 3 .8 4 2 1-1.2 2.5-2 4-2 3 0 5 2 5 5 0 7-7 12-9 13z" fill="#A04E2E"/>
  </svg>
);

const PersonaIconBeginner = ({ size = 32 }: PersonaIconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M22 42v-16" stroke="#5D3A14" strokeWidth="2.6" strokeLinecap="round"/>
    <path d="M22 28c-7 0-11-4-11-10 7 0 11 4 11 10z" fill="#D4B58A"/>
    <path d="M22 28c7 0 11-4 11-10-7 0-11 4-11 10z" fill="#7A4A1D"/>
  </svg>
);

const PersonaIconKids = ({ size = 32 }: PersonaIconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <circle cx="24" cy="24" r="16" fill="#D4B58A"/>
    <circle cx="18.5" cy="22" r="1.8" fill="#7A4A1D"/>
    <circle cx="29.5" cy="22" r="1.8" fill="#7A4A1D"/>
    <path d="M17 28c2 3.5 4.5 5 7 5s5-1.5 7-5" stroke="#7A4A1D" strokeWidth="2" fill="none" strokeLinecap="round"/>
  </svg>
);

interface PersonaDef {
  key: PersonaMode;
  Icon: React.FC<PersonaIconProps>;
  label: string;
  description: string;
  /** 강조 라벨 (예: 추천 / 위급 자동) */
  badge?: string;
}

export const PERSONAS: PersonaDef[] = [
  {
    key: "standard",
    Icon: PersonaIconStandard,
    label: "표준",
    description: "질문에 가장 알맞은 톤으로 답변",
    badge: "추천",
  },
  {
    key: "theological",
    Icon: PersonaIconTheological,
    label: "신학자",
    description: "원리·교리 깊이 있는 해설",
  },
  {
    key: "pastoral",
    Icon: PersonaIconPastoral,
    label: "목회 상담",
    description: "위로와 공감 중심 — 위급 키워드 자동 라우팅",
  },
  {
    key: "beginner",
    Icon: PersonaIconBeginner,
    label: "초신자",
    description: "쉬운 말로 짧고 친절하게",
  },
  {
    key: "kids",
    Icon: PersonaIconKids,
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
          className="flex flex-col gap-2 px-4 overflow-y-auto"
        >
          {PERSONAS.map((p) => {
            const active = draft === p.key;
            const { Icon } = p;
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDraft(p.key)}
                className={cn(
                  "group flex items-center gap-4 rounded-2xl border px-4 py-3.5 text-left",
                  "transition-all duration-200 active:scale-[0.99]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-accent bg-accent/5"
                    : "border-border bg-card hover:bg-accent/5"
                )}
              >
                {/* 아이콘 영역 — 둥근 사각형 + 따뜻한 베이지 배경 */}
                <span
                  className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#F5EDE0]"
                  aria-hidden="true"
                >
                  <Icon />
                </span>

                {/* 텍스트 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{p.label}</span>
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
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                    active ? "border-accent" : "border-border"
                  )}
                >
                  {active ? (
                    <span className="size-2.5 rounded-full bg-accent" />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <SheetFooter className="px-5 pt-3 pb-safe">
          <ChatButton onClick={handleApply} size="xl" fullWidth>
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
  const { Icon } = persona;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3",
        "hover:bg-accent/5 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      )}
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#F5EDE0]">
        <Icon />
      </span>
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
