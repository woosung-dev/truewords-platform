"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X, ThumbsDown, ThumbsUp, Bookmark } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { analyticsAPI } from "@/features/analytics/api";
import type { SessionMessage } from "@/features/analytics/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
}

const FEEDBACK_LABELS: Record<string, string> = {
  helpful: "도움됨",
  inaccurate: "부정확",
  missing_citation: "출처 부족",
  irrelevant: "관련 없음",
  other: "기타",
};

const REACTION_ICON: Record<string, typeof ThumbsUp> = {
  thumbs_up: ThumbsUp,
  thumbs_down: ThumbsDown,
  save: Bookmark,
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(/\. /g, ".")
    .replace(/\.$/, "");
}

function MessageBubble({ msg }: { msg: SessionMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
          isUser
            ? "bg-foreground text-background"
            : "bg-admin-muted text-foreground"
        }`}
      >
        <div
          className={`text-[10px] mb-1 ${
            isUser ? "text-background/60" : "text-muted-foreground"
          }`}
        >
          {isUser ? "사용자" : "챗봇"} · {formatDateTime(msg.created_at)}
        </div>
        <div className="whitespace-pre-wrap break-words">{msg.content}</div>

        {!isUser && msg.reactions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {msg.reactions.map((r) => {
              const Icon = REACTION_ICON[r.kind] ?? ThumbsUp;
              return (
                <span
                  key={r.kind}
                  className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-0.5 text-[11px] text-foreground"
                >
                  <Icon className="h-3 w-3" />
                  {r.count}
                </span>
              );
            })}
          </div>
        )}

        {!isUser && msg.feedback && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px]">
            <div className="flex items-center gap-1.5">
              <Badge
                variant={
                  msg.feedback.feedback_type === "inaccurate"
                    ? "destructive"
                    : "secondary"
                }
              >
                {FEEDBACK_LABELS[msg.feedback.feedback_type] ??
                  msg.feedback.feedback_type}
              </Badge>
              <span className="text-muted-foreground">
                {formatDateTime(msg.feedback.created_at)}
              </span>
            </div>
            {msg.feedback.comment && (
              <div className="mt-1 text-foreground">
                “{msg.feedback.comment}”
              </div>
            )}
          </div>
        )}

        {!isUser && msg.citations.length > 0 && (
          <details className="mt-2 text-[11px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              출처 {msg.citations.length}건
            </summary>
            <ul className="mt-1.5 space-y-1.5">
              {msg.citations.map((c) => (
                <li
                  key={c.rank_position}
                  className="rounded bg-background/40 px-2 py-1"
                >
                  <span className="font-medium">
                    [{c.source}] vol.{c.volume}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    score {c.relevance_score.toFixed(2)}
                  </span>
                  <div className="mt-0.5 text-muted-foreground line-clamp-2">
                    {c.text_snippet}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

export default function SessionDetailModal({
  open,
  onOpenChange,
  sessionId,
}: Props) {
  const enabled = open && !!sessionId;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["session-detail", sessionId],
    queryFn: () => analyticsAPI.getSessionDetail(sessionId!),
    enabled,
    staleTime: 30_000,
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-0 z-50 m-auto flex h-fit max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-popover shadow-2xl transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95">
          <div className="flex items-start justify-between border-b px-6 py-4 gap-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">
                대화 상세 기록
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-1">
                {data
                  ? `${data.chatbot_name ?? "(봇 미지정)"} · 시작 ${formatDateTime(
                      data.started_at
                    )} · 메시지 ${data.messages.length}건`
                  : "불러오는 중..."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1 text-muted-foreground hover:bg-admin-muted hover:text-foreground transition-colors shrink-0">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto px-6 py-4 space-y-3">
            {isLoading && (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center gap-3 py-10">
                <p className="text-sm text-muted-foreground">
                  대화 정보를 불러오지 못했습니다
                </p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  다시 시도
                </Button>
              </div>
            )}

            {!isLoading && !isError && data && data.messages.length === 0 && (
              <p className="text-sm text-muted-foreground py-10 text-center">
                메시지가 없습니다
              </p>
            )}

            {!isLoading &&
              !isError &&
              data &&
              data.messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
