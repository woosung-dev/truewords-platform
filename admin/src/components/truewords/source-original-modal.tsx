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
  chunk_index: number;
  /** 메인 + 인접 청크를 백엔드에서 NFC + suffix-prefix dedup 후 합친 연속 본문 */
  merged_text: string;
  /** merged_text 안에서 메인 청크 시작 character offset (포함) */
  main_offset_start: number;
  /** merged_text 안에서 메인 청크 끝 character offset (제외) */
  main_offset_end: number;
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
      const { merged_text, main_offset_start, main_offset_end, text } = state.detail;
      // merged_text 가 비어있는 비정상 케이스: 단일 청크 fallback.
      const body = merged_text || text;
      const mainStart = merged_text ? main_offset_start : 0;
      const mainEnd = merged_text ? main_offset_end : text.length;
      const before = body.slice(0, mainStart);
      const main = body.slice(mainStart, mainEnd);
      const after = body.slice(mainEnd);

      return (
        <article className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground tabular-nums break-keep-all">
            {fallbackLabel ?? state.detail.volume}
          </p>
          {/* 단일 연속 본문 — 백엔드가 dedup 후 보낸 한 덩어리. 청크 경계 끊김 0.
              메인 청크 영역만 brass 좌측 border + 옅은 accent 배경으로 강조. */}
          <p className="font-reading text-[15.5px] leading-[1.85] text-foreground break-keep-all whitespace-pre-line">
            {before && (
              <span className="text-muted-foreground">{before}</span>
            )}
            {main && (
              <span className="rounded-sm bg-accent/10 px-1 py-0.5 ring-1 ring-accent/20">
                {renderWithHighlight(main, highlightSnippet)}
              </span>
            )}
            {after && (
              <span className="text-muted-foreground">{after}</span>
            )}
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
            인용된 부분은 강조 표시되고, 위·아래 인접 문맥이 옅게 함께 노출됩니다.
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
