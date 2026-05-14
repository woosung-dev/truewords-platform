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
import { useSourceChunk } from "@/features/chat/hooks";
import { cn } from "@/lib/utils";

// P0-B + ADR-46 §C.3 — 인용 카드의 "원문보기" 모달.
// CitationCard 의 onOpenOriginal prop 에 연결해서 사용한다.
//
// 데이터 fetch 는 features/chat/hooks 의 useSourceChunk 로 분리됨
// (이 컴포넌트는 표시 책임만). 종교 도메인 묵상 톤을 위해 형광 highlight 를
// 폐기하고 main/adjacent 색 구분만으로 인용 영역을 표시한다.

export interface SourceOriginalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chunkId: string | null;
  /** ACL 검증용 chatbot_id (필수) — 답변을 받은 chatbot 의 source filter 적용 */
  chatbotId: string;
  /** 답변 화면의 인용 카드 메타 (서버 응답 전 placeholder) */
  fallbackLabel?: string;
}

export function SourceOriginalModal({
  open,
  onOpenChange,
  chunkId,
  chatbotId,
  fallbackLabel,
}: SourceOriginalModalProps) {
  const { data, isLoading, error } = useSourceChunk(chunkId, chatbotId, open);

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          원문을 불러오는 중…
        </div>
      );
    }
    if (error) {
      return (
        <p className="py-8 text-sm text-destructive">{(error as Error).message}</p>
      );
    }
    if (data) {
      const { merged_text, main_offset_start, main_offset_end, text } = data;
      // merged_text 가 비어있는 비정상 케이스: 단일 청크 fallback.
      const body = merged_text || text;
      const mainStart = merged_text ? main_offset_start : 0;
      const mainEnd = merged_text ? main_offset_end : text.length;

      return (
        <article className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground tabular-nums break-keep-all">
            {fallbackLabel ?? data.volume}
          </p>
          {/* 단일 연속 본문 — 백엔드가 dedup 후 보낸 한 덩어리. 청크 경계 끊김 0.
              메인 청크는 일반 text-foreground, 인접 문맥은 muted 처리. */}
          <p className="font-reading text-[15.5px] leading-[1.85] text-foreground break-keep-all whitespace-pre-line">
            {renderBody3Tone(body, mainStart, mainEnd)}
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
        {/* 데스크톱(wide)에서 본문이 좌측에 좁게 쌓여 모달이 한쪽으로 치우친 것처럼
            보이는 문제(#2) 해결 — 헤더·본문을 max-w + mx-auto 로 가운데 정렬. */}
        <SheetHeader className="mx-auto w-full max-w-3xl px-0 pt-0 pb-3">
          <SheetTitle className="flex items-center gap-1.5 text-lg">
            <ArrowUpRight className="size-4 text-accent" aria-hidden="true" />
            원문 보기
          </SheetTitle>
          <SheetDescription>
            인용된 메인 청크와 위·아래 인접 문맥을 함께 보여드립니다.
          </SheetDescription>
        </SheetHeader>
        <div className="mx-auto w-full max-w-3xl">{renderBody()}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * 종교 도메인 묵상 톤을 위해 형광 highlight 를 사용하지 않고, 메인 청크와
 * 인접 문맥을 색 톤 대비 (foreground vs muted-foreground) 만으로 구분한다.
 *
 * NotebookLM 식 phrase highlight 는 학술/연구 메타포로 종교 묵상 분위기와
 * 충돌. YouVersion·천성경 등 동종 종교 앱도 동일하게 highlight 미사용.
 */
export function renderBody3Tone(
  body: string,
  mainStart: number,
  mainEnd: number,
): React.ReactNode {
  const safeStart = Math.max(0, Math.min(mainStart, body.length));
  const safeEnd = Math.max(safeStart, Math.min(mainEnd, body.length));

  const before = body.slice(0, safeStart);
  const main = body.slice(safeStart, safeEnd);
  const after = body.slice(safeEnd);

  return (
    <>
      {before && (
        <span className="text-muted-foreground">{before}</span>
      )}
      {main}
      {after && (
        <span className="text-muted-foreground">{after}</span>
      )}
    </>
  );
}
