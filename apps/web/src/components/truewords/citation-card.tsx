"use client";

import * as React from "react";
import { ArrowUpRight, BookOpen, ScrollText, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";

// Plan B.3 + P1-B(4중 메타) + P1-H(3-탭) + P0-B(원문 모달)
export type CitationTab = "haeseol" | "bonmun" | "note";

export interface CitationMeta {
  /** 권 번호 — P1-B */
  volumeNo: number;
  /** 일자 (ISO 또는 한국어) — P1-B */
  deliveredAt: string;
  /** 장소 — P1-B */
  deliveredPlace?: string;
  /** 챕터 제목 — P1-B */
  chapterTitle?: string;
  /** 추가 라벨 (편의) */
  label?: string;
}

export interface CitationCardProps {
  meta: CitationMeta;
  /** 인용 본문 (해설 탭의 기본 내용) */
  haeseol: React.ReactNode;
  /** 원문 본문 (P0-B) — 비어있으면 본문 탭 잠금 또는 paywall */
  bonmun?: React.ReactNode;
  /** 노트 영역 — null이면 잠금 (비로그인) */
  note?: React.ReactNode;
  /** 본문 페이지로 jump (P1-L) */
  onJumpToSource?: () => void;
  /** 원문 모달 열기 (P0-B) */
  onOpenOriginal?: () => void;
  /** 잠금 탭 클릭 시 (P2-J freemium paywall) */
  onLockedTabClick?: (tab: CitationTab) => void;
  className?: string;
  defaultTab?: CitationTab;
}

function formatMeta(meta: CitationMeta): string {
  const parts = [
    `${meta.volumeNo}권`,
    meta.deliveredAt,
    meta.deliveredPlace,
    meta.chapterTitle,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function CitationCard({
  meta,
  haeseol,
  bonmun,
  note,
  onJumpToSource,
  onOpenOriginal,
  onLockedTabClick,
  className,
  defaultTab = "haeseol",
}: CitationCardProps) {
  const [tab, setTab] = React.useState<CitationTab>(defaultTab);

  const tabs: Array<{
    key: CitationTab;
    icon: React.ElementType;
    label: string;
    locked: boolean;
  }> = [
    { key: "haeseol", icon: BookOpen, label: "해설", locked: false },
    {
      key: "bonmun",
      icon: ScrollText,
      label: "본문",
      locked: bonmun === undefined,
    },
    {
      key: "note",
      icon: PenLine,
      label: "노트",
      locked: note === undefined,
    },
  ];

  const handleTabClick = (target: CitationTab, locked: boolean) => {
    if (locked) {
      onLockedTabClick?.(target);
      return;
    }
    setTab(target);
  };

  return (
    <article
      data-slot="citation-card"
      className={cn(
        "relative overflow-hidden rounded-xl border bg-surface-muted",
        "border-l-[3px] border-l-border-strong border-border",
        "shadow-(--tw-shadow-card)",
        className
      )}
    >
      {/* Header — 인용 메타 4중 (P1-B) */}
      <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <p className="font-mono text-[11px] leading-snug text-muted-foreground tabular-nums break-keep-all">
          [{formatMeta(meta)}]
        </p>
        {onOpenOriginal ? (
          <button
            type="button"
            onClick={onOpenOriginal}
            className="inline-flex shrink-0 items-center gap-0.5 text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring rounded"
            aria-label={`${meta.volumeNo}권 원문 모달 열기`}
          >
            원문
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {/* Body — tab content */}
      <div className="px-4 pb-3">
        <div
          role="tabpanel"
          id={`citation-panel-${tab}`}
          aria-labelledby={`citation-tab-${tab}`}
          className={cn(
            "min-h-12 leading-relaxed text-foreground",
            tab === "haeseol" && "font-reading text-[15px] leading-[1.75]",
            tab === "bonmun" && "font-reading text-[15px] leading-[1.85]",
            tab === "note" && "text-sm"
          )}
        >
          {tab === "haeseol" && haeseol}
          {tab === "bonmun" && bonmun}
          {tab === "note" && note}
        </div>

        {/* P1-L — 본문 페이지로 jump */}
        {onJumpToSource && tab === "haeseol" ? (
          <button
            type="button"
            onClick={onJumpToSource}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-ring rounded"
          >
            본문 전체 읽기
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Tabs — 카드 단위 3-탭 (P1-H) */}
      <div
        role="tablist"
        aria-label="인용 카드 탭"
        className="flex border-t border-border bg-card"
      >
        {tabs.map(({ key, icon: Icon, label, locked }) => {
          const active = tab === key && !locked;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`citation-tab-${key}`}
              aria-selected={active}
              aria-controls={`citation-panel-${key}`}
              aria-disabled={locked}
              onClick={() => handleTabClick(key, locked)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 py-2.5",
                "text-xs font-medium tracking-tight transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                active
                  ? "border-t-2 border-t-primary text-primary -mt-px"
                  : "text-muted-foreground hover:bg-secondary",
                locked && "text-fg-subtle"
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
              {locked ? (
                <span className="ml-0.5 text-[10px]" aria-hidden="true">
                  🔒
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </article>
  );
}
