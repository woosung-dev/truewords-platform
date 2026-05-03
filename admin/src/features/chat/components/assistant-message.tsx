"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatResponse } from "@/features/chatbot/chat-api";
import { cn } from "@/lib/utils";

type Source = NonNullable<ChatResponse["sources"]>[number];

export interface AssistantMessageProps {
  /** AI 답변 본문 (면책 고지 strip 후) */
  content: string;
  sources?: Source[];
  /** 출처 카드 클릭 시 P0-B 원문보기 모달 트리거 */
  onSourceClick?: (source: Source) => void;
  className?: string;
}

/**
 * AssistantMessage — 모던 챗 답변 렌더러.
 *
 * - 마크다운 (react-markdown + remark-gfm): 테이블/볼드/리스트 정상 렌더.
 * - 인라인 citation `[1]` `[2]` → 클릭 가능한 위첨자 → 출처 카드 매칭.
 *   (백엔드 prompt 가 emit. 못 emit 해도 graceful — 카드는 그대로 노출.)
 * - 본문 [출처: ...] 잔류 텍스트는 정규식으로 strip.
 * - sources 는 번호 매겨진 카드 그리드로 하단 노출.
 */
export function AssistantMessage({
  content,
  sources,
  onSourceClick,
  className,
}: AssistantMessageProps) {
  const cleaned = React.useMemo(() => preprocess(content), [content]);
  const sourceMap = React.useMemo(() => buildSourceMap(sources), [sources]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="prose prose-sm max-w-none prose-chat">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // [N](cite:N) 마크다운 링크를 클릭 가능한 위첨자로 변환.
            a: ({ href, children, ...rest }) => {
              if (href?.startsWith("cite:")) {
                const num = href.slice("cite:".length);
                const src = sourceMap.get(num);
                return (
                  <button
                    type="button"
                    aria-label={`출처 ${num}${src ? `: ${src.volume}` : ""}`}
                    onClick={() => src && onSourceClick?.(src)}
                    className="mx-0.5 inline-flex h-[18px] min-w-[18px] cursor-pointer items-center justify-center rounded bg-accent/15 px-1.5 align-[2px] text-[11px] font-bold leading-none text-accent transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    {num}
                  </button>
                );
              }
              return (
                <a href={href} {...rest}>
                  {children}
                </a>
              );
            },
          }}
        >
          {cleaned}
        </ReactMarkdown>
      </div>

      {sources && sources.length > 0 && (
        <SourceCardGrid sources={sources} onSourceClick={onSourceClick} />
      )}
    </div>
  );
}

interface SourceCardGridProps {
  sources: Source[];
  onSourceClick?: (source: Source) => void;
}

function SourceCardGrid({ sources, onSourceClick }: SourceCardGridProps) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {sources.map((src, idx) => {
        const num = idx + 1;
        const clickable = !!src.chunk_id;
        const Tag = clickable ? "button" : "div";
        return (
          <Tag
            key={`${src.chunk_id || src.volume}-${idx}`}
            type={clickable ? "button" : undefined}
            onClick={clickable ? () => onSourceClick?.(src) : undefined}
            className={cn(
              "group flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors",
              clickable
                ? "cursor-pointer hover:border-accent hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                : "cursor-default",
            )}
          >
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded bg-accent/15 text-[11px] font-bold text-accent"
            >
              {num}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-foreground">
                {src.volume}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {src.source ? `${src.source} · ` : ""}
                {clickable ? "클릭하여 원문 보기 →" : "원문 미연결"}
              </span>
            </span>
          </Tag>
        );
      })}
    </div>
  );
}

function buildSourceMap(sources?: Source[]): Map<string, Source> {
  const map = new Map<string, Source>();
  if (!sources) return map;
  sources.forEach((src, idx) => {
    map.set(String(idx + 1), src);
  });
  return map;
}

/**
 * 답변 본문 사전처리:
 *   1. `[출처: ...]` 라인 제거 (백엔드 prompt 미반영 대비 graceful fallback).
 *   2. `[1]` `[2]` → `[1](cite:1)` 마크다운 링크로 치환 → react-markdown 이
 *      components.a 에서 위첨자로 렌더.
 *
 * 동일 토큰이 markdown link `[text](url)` 로 잘못 잡히지 않게 정규식은 뒤에
 * `(` 가 붙지 않은 경우만 매칭.
 */
function preprocess(text: string): string {
  if (!text) return "";
  return text
    .replace(/\n?\[출처:[^\]]*\](?:\s*\([^)]*\))?\s*/g, "")
    .replace(/\[(\d+)\](?!\()/g, "[$1](cite:$1)")
    .trim();
}

/** ClosingCalloutCard — 본문과 시각적으로 분리된 권유 안내 (B1). */
export interface ClosingCalloutProps {
  /** 백엔드 ClosingTemplateStage 결과 (prayer/resolution). null 이면 보조 멘트 출력. */
  closing?: string | null;
  className?: string;
}

export function ClosingCallout({ closing, className }: ClosingCalloutProps) {
  if (closing) {
    return (
      <div
        className={cn(
          "rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 text-sm leading-relaxed text-foreground/90",
          className,
        )}
      >
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
          <span aria-hidden="true">✦</span>
          <span>마무리 기도/결의</span>
        </div>
        {closing}
      </div>
    );
  }
  // 기본 권유 callout — 모든 답변에 동일.
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-secondary/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <span className="mr-1.5" aria-hidden="true">
        💬
      </span>
      <span className="font-medium text-foreground">
        더 깊은 말씀이 필요하신가요?
      </span>{" "}
      소속 교회나 담당 목회자님께 상담을 요청하시길 권해드립니다.
    </div>
  );
}
