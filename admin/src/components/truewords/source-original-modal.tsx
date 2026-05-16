"use client";

import * as React from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn, stripFileExt } from "@/lib/utils";

// P0-B + ADR-46 §C.3 — 인용 카드의 "원문보기" 모달.
// CitationCard 의 onOpenOriginal prop 에 연결해서 사용한다.
//
// 데이터 fetch 는 GET /api/sources/chunks/{chunk_id} 호출. React Query 로
// (chunk_id, chatbot_id) 단위 캐싱 — 같은 출처 재오픈 시 즉시 표시.
// 메인 청크는 부드러운 yellow 배경 + medium weight 로 강조한다 (사용자
// 가시성 우선). 인접 문맥은 muted-foreground 로 처리해 톤 차이도 함께 유지.

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
  // React Query 캐싱 — 같은 (chunk_id, chatbot_id) 재오픈 시 staleTime 내엔 추가 fetch 없음.
  // 원문은 거의 변하지 않으므로 5분으로 길게 잡았다 (Provider default 30s 를 override).
  const { data, isLoading, error } = useQuery<SourceChunkDetail>({
    queryKey: ["source-chunk", chunkId, chatbotId],
    enabled: open && !!chunkId && !!chatbotId,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const url = `/api/sources/chunks/${encodeURIComponent(chunkId!)}?chatbot_id=${encodeURIComponent(chatbotId)}`;
      const res = await fetch(url, { signal });
      if (res.status === 404) throw new Error("청크를 찾을 수 없어요");
      if (res.status === 403)
        throw new Error("이 챗봇의 검색 범위에 포함되지 않은 자료입니다");
      if (!res.ok) throw new Error("원문을 불러오지 못했어요");
      return (await res.json()) as SourceChunkDetail;
    },
  });

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

      // 라벨 정책: 1순위 fallbackLabel (caller 가 넘긴 displayName), 2순위 data.volume.
      // 양쪽 모두 stripFileExt 로 통과시켜 raw filename(.txt 등) 노출 방지.
      // assistant-message.tsx 의 SourceCardGrid 와 동일 패턴.
      const sourceLabel = stripFileExt((fallbackLabel ?? data.volume).trim());

      return (
        <article className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground tabular-nums break-keep-all">
            {sourceLabel}
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
 * 메인 청크는 <mark> 시멘틱 태그 + 부드러운 yellow 배경 + medium weight 로
 * 강조하고, 위·아래 인접 문맥은 muted-foreground 로 처리한다.
 *
 * 이전 흐름(#135 좌측 border 제거 → #156 단순화 → #164 매칭 확장 → #167
 * 형광 폐기) 의 "묵상 톤" 결정은 메인 청크가 시각적으로 식별되지 않는
 * 문제로 인해 본 변경에서 사용자 요청으로 철회. 형광 톤은 paper/dark 양쪽
 * 테마에서 부담스럽지 않게 낮은 채도의 yellow 로 유지.
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
      {main && (
        <mark className="rounded-sm bg-yellow-200/60 px-0.5 font-medium text-foreground dark:bg-yellow-500/25">
          {main}
        </mark>
      )}
      {after && (
        <span className="text-muted-foreground">{after}</span>
      )}
    </>
  );
}
