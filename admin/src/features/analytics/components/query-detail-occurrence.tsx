"use client";

import { ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { QueryOccurrence } from "@/features/analytics/types";

interface Props {
  index: number;
  occurrence: QueryOccurrence;
  expanded: boolean;
  onToggle: () => void;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function FeedbackIcon({ type }: { type: string | undefined }) {
  if (!type) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="피드백 없음" />;
  }
  if (type.toUpperCase() === "HELPFUL") {
    return <ThumbsUp className="h-3.5 w-3.5 text-success" aria-label="도움됨" />;
  }
  return <ThumbsDown className="h-3.5 w-3.5 text-destructive" aria-label="부정 피드백" />;
}

export default function QueryDetailOccurrence({
  index,
  occurrence,
  expanded,
  onToggle,
}: Props) {
  const botLabel = occurrence.chatbot_name ?? "(삭제된 봇)";
  const feedbackType = occurrence.feedback?.feedback_type;

  const headerId = `occ-header-${index}`;
  const panelId = `occ-panel-${index}`;

  return (
    <div className="rounded-lg border bg-card">
      <button
        id={headerId}
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-admin-muted/40 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono text-xs text-muted-foreground w-6 shrink-0">
          #{index + 1}
        </span>
        <Badge variant="outline" className="shrink-0 text-xs">
          {botLabel}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatDateTime(occurrence.asked_at)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <FeedbackIcon type={feedbackType} />
        </span>
      </button>

      {expanded && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="border-t px-4 py-4 space-y-4 text-sm"
        >
          {/* 검색 메타 */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>tier {occurrence.search_tier}</span>
            <span>·</span>
            <span>{occurrence.total_results}건</span>
            <span>·</span>
            <span>{occurrence.latency_ms} ms</span>
            {occurrence.rewritten_query && (
              <>
                <span>·</span>
                <span>
                  재작성:{" "}
                  <span className="text-foreground">
                    &ldquo;{occurrence.rewritten_query}&rdquo;
                  </span>
                </span>
              </>
            )}
          </div>

          {/* 답변 */}
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-muted-foreground">답변</h3>
            {occurrence.answer_text ? (
              <p className="whitespace-pre-wrap leading-relaxed">
                {occurrence.answer_text}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                답변이 저장되지 않았습니다
              </p>
            )}
          </div>

          {/* 출처 */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">
              매칭 출처 ({occurrence.citations.length}건)
            </h3>
            {occurrence.citations.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                매칭된 출처가 없습니다
              </p>
            ) : (
              <ol className="space-y-2">
                {occurrence.citations.map((c, i) => (
                  <li
                    key={`${c.source}-${c.volume}-${c.rank_position}-${i}`}
                    className="rounded-md border bg-admin-muted/30 p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">#{c.rank_position + 1}</span>
                      <Badge variant="outline" className="text-xs">
                        {c.source}
                      </Badge>
                      <span>권 {c.volume}</span>
                      {c.chapter && <span>· {c.chapter}</span>}
                      <span className="ml-auto font-mono">
                        score {c.relevance_score.toFixed(3)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">
                      {c.text_snippet}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* 피드백 */}
          {occurrence.feedback && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground">피드백</h3>
              <div className="rounded-md border bg-admin-muted/30 p-3 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {occurrence.feedback.feedback_type}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatDateTime(occurrence.feedback.created_at)}
                  </span>
                </div>
                {occurrence.feedback.comment && (
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {occurrence.feedback.comment}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
