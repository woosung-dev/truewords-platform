"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  loadNote,
  saveNote,
  NOTE_BODY_MAX_LENGTH,
} from "@/lib/notes-api";

// W3-⑪c P1-H — CitationCard.note prop 으로 주입되는 자동저장 textarea.
//
// 동작:
//  - 마운트 시 GET /citation-note?chunk_id=... 로 초기값 로드
//  - 입력 변경 시 2 초 debounce 후 PUT /citation-note 로 저장
//  - 저장 중 / 저장됨 / 실패 micro-status 표기

export interface CitationNoteTextareaProps {
  messageId: string;
  chunkId: string;
  /** 비활성 상태 — 잠금 / 비로그인 등 (CitationCard 외부에서 제어) */
  disabled?: boolean;
  /** debounce 시간 ms — 기본 2000 */
  debounceMs?: number;
  className?: string;
  placeholder?: string;
}

type SaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

export function CitationNoteTextarea({
  messageId,
  chunkId,
  disabled = false,
  debounceMs = 2000,
  className,
  placeholder = "이 인용에 대한 메모를 남겨보세요…",
}: CitationNoteTextareaProps) {
  const [body, setBody] = React.useState<string>("");
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // 초기 서버 값 로드 후 dirty 추적용 ref. 초기 fetch 결과를 그대로 setBody 하면
  // 직후 useEffect 가 "변경됐다" 라고 오인하지 않도록 isDirtyRef 로 분리.
  const lastSavedRef = React.useRef<string>("");
  const isDirtyRef = React.useRef<boolean>(false);
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // ─── 1. 초기 로드 ────────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);
    loadNote(messageId, chunkId)
      .then((note) => {
        if (cancelled) return;
        const initial = note?.body ?? "";
        setBody(initial);
        lastSavedRef.current = initial;
        isDirtyRef.current = false;
        setStatus("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [messageId, chunkId]);

  // ─── 2. debounce 자동저장 ───────────────────────────────────────
  React.useEffect(() => {
    if (!isDirtyRef.current) return;
    if (disabled) return;
    if (body === lastSavedRef.current) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const timer = setTimeout(async () => {
      // 직전 in-flight 저장 abort.
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setStatus("saving");
      setErrorMessage(null);
      try {
        await saveNote(messageId, chunkId, body);
        lastSavedRef.current = body;
        isDirtyRef.current = false;
        setStatus("saved");
      } catch (err) {
        if (controller.signal.aborted) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }, debounceMs);

    debounceTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
    };
  }, [body, disabled, debounceMs, messageId, chunkId]);

  // 마운트 해제 시 cleanup.
  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value.slice(0, NOTE_BODY_MAX_LENGTH);
    isDirtyRef.current = true;
    setBody(next);
  };

  const remaining = NOTE_BODY_MAX_LENGTH - body.length;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <textarea
        value={body}
        onChange={handleChange}
        disabled={disabled || status === "loading"}
        placeholder={placeholder}
        maxLength={NOTE_BODY_MAX_LENGTH}
        rows={4}
        aria-label="인용 카드 노트"
        className={cn(
          "w-full resize-y rounded-md border border-border bg-card px-3 py-2",
          "text-sm leading-relaxed text-foreground placeholder:text-fg-subtle",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      />
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <NoteStatusBadge status={status} errorMessage={errorMessage} />
        <span
          aria-live="polite"
          className={cn(
            "tabular-nums",
            remaining < 100 && "text-warning",
            remaining < 0 && "text-destructive",
          )}
        >
          {body.length} / {NOTE_BODY_MAX_LENGTH}
        </span>
      </div>
    </div>
  );
}

interface NoteStatusBadgeProps {
  status: SaveStatus;
  errorMessage: string | null;
}

function NoteStatusBadge({ status, errorMessage }: NoteStatusBadgeProps) {
  let text = "";
  let tone = "text-muted-foreground";
  switch (status) {
    case "loading":
      text = "불러오는 중…";
      break;
    case "saving":
      text = "저장 중…";
      break;
    case "saved":
      text = "저장됨";
      tone = "text-accent";
      break;
    case "error":
      text = errorMessage ?? "저장 실패";
      tone = "text-destructive";
      break;
    case "idle":
    default:
      text = "";
  }
  return (
    <span aria-live="polite" className={tone}>
      {text}
    </span>
  );
}
