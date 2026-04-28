"use client";

import * as React from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// P0-B + ADR-46 §C.3 — 인용 카드의 "원문보기" 모달.
// CitationCard 의 onOpenOriginal prop 에 연결해서 사용한다.
//
// 데이터 fetch 는 GET /api/sources/chunks/{chunk_id} 호출. 인용된 텍스트가
// 본문 안에 있으면 노란 하이라이트 (`<mark className="tw-highlight">`) 처리.

export interface SourceChunkDetail {
  chunk_id: string;
  text: string;
  volume: string;
  sources: string[];
  citation_label: string | null;
  volume_no: number | null;
  delivered_at: string | null;
  delivered_place: string | null;
  chapter_title: string | null;
}

export interface SourceOriginalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chunkId: string | null;
  /** ACL 검증용 chatbot_id (필수) — 답변을 받은 chatbot 의 source filter 적용 */
  chatbotId: string;
  /** 인용 카드에서 노출됐던 부분 — 모달 본문에서 노란 하이라이트로 강조 */
  highlightSnippet?: string;
  /** 답변 화면의 인용 카드 메타 (서버 응답 전 placeholder) */
  fallbackLabel?: string;
}

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; detail: SourceChunkDetail }
  | { status: "error"; message: string };

export function SourceOriginalModal({
  open,
  onOpenChange,
  chunkId,
  chatbotId,
  highlightSnippet,
  fallbackLabel,
}: SourceOriginalModalProps) {
  const [state, setState] = React.useState<FetchState>({ status: "idle" });

  React.useEffect(() => {
    if (!open || !chunkId || !chatbotId) return;
    setState({ status: "loading" });
    const ctrl = new AbortController();
    const url = `/api/sources/chunks/${encodeURIComponent(chunkId)}?chatbot_id=${encodeURIComponent(chatbotId)}`;
    fetch(url, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (res.status === 404) {
          throw new Error("청크를 찾을 수 없어요");
        }
        if (res.status === 403) {
          throw new Error("이 챗봇의 검색 범위에 포함되지 않은 자료입니다");
        }
        if (!res.ok) {
          throw new Error("원문을 불러오지 못했어요");
        }
        return (await res.json()) as SourceChunkDetail;
      })
      .then((detail) => setState({ status: "ok", detail }))
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setState({ status: "error", message: err.message });
      });
    return () => ctrl.abort();
  }, [open, chunkId]);

  const renderBody = () => {
    if (state.status === "loading") {
      return (
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          원문을 불러오는 중…
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <p className="py-8 text-sm text-destructive">{state.message}</p>
      );
    }
    if (state.status === "ok") {
      return (
        <article className="space-y-3">
          <p className="font-mono text-xs text-muted-foreground tabular-nums break-keep-all">
            {state.detail.citation_label ?? fallbackLabel ?? state.detail.volume}
          </p>
          <p className="font-reading text-[16px] leading-[1.85] text-foreground break-keep-all whitespace-pre-line">
            {renderWithHighlight(state.detail.text, highlightSnippet)}
          </p>
        </article>
      );
    }
    return null;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn("max-h-[85vh] overflow-y-auto rounded-t-2xl px-5 pt-5 pb-safe")}
        aria-label="원문 보기"
      >
        <SheetHeader className="px-0 pt-0 pb-3">
          <SheetTitle className="flex items-center gap-1.5 text-lg">
            <ArrowUpRight className="size-4 text-accent" aria-hidden="true" />
            원문 보기
          </SheetTitle>
          <SheetDescription>
            인용된 부분은 노란색으로 표시됩니다.
          </SheetDescription>
        </SheetHeader>
        <div>{renderBody()}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * highlightSnippet 이 본문 내에 있으면 그 부분을 <mark className="tw-highlight"> 로 감싼다.
 * 단순 substring 매칭 — case-sensitive, 공백 정규화 X. 정확도 부족 시 P0-B 후속에서 정교화.
 */
function renderWithHighlight(
  text: string,
  snippet?: string,
): React.ReactNode {
  if (!snippet) return text;
  const idx = text.indexOf(snippet);
  if (idx < 0) return text;
  const before = text.slice(0, idx);
  const matched = text.slice(idx, idx + snippet.length);
  const after = text.slice(idx + snippet.length);
  return (
    <>
      {before}
      <mark className="tw-highlight">{matched}</mark>
      {after}
    </>
  );
}
