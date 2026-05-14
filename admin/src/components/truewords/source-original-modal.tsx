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
import { cn } from "@/lib/utils";

// P0-B + ADR-46 §C.3 — 인용 카드의 "원문보기" 모달.
// CitationCard 의 onOpenOriginal prop 에 연결해서 사용한다.
//
// 데이터 fetch 는 GET /api/sources/chunks/{chunk_id} 호출. React Query 로
// (chunk_id, chatbot_id) 단위 캐싱 — 같은 출처 재오픈 시 즉시 표시. 인용된
// 텍스트가 본문 안에 있으면 노란 하이라이트 (`<mark className="tw-highlight">`) 처리.

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

export function SourceOriginalModal({
  open,
  onOpenChange,
  chunkId,
  chatbotId,
  highlightSnippet,
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

      return (
        <article className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground tabular-nums break-keep-all">
            {fallbackLabel ?? data.volume}
          </p>
          {/* 단일 연속 본문 — 백엔드가 dedup 후 보낸 한 덩어리. 청크 경계 끊김 0.
              메인 청크는 일반 text-foreground, 인접 문맥은 muted 처리.
              인용 매칭은 body 전체 범위에서 검색 — dedup 으로 main 슬라이스가
              snippet(전체 청크 본문) 보다 짧아도 인접 영역까지 포함해 강조 노출. */}
          <p className="font-reading text-[15.5px] leading-[1.85] text-foreground break-keep-all whitespace-pre-line">
            {renderBodyWithHighlight(body, mainStart, mainEnd, highlightSnippet)}
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
            인용된 부분은 강조 표시되고, 위·아래 인접 문맥이 옅게 함께 노출됩니다.
          </SheetDescription>
        </SheetHeader>
        <div className="mx-auto w-full max-w-3xl">{renderBody()}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * body 전체 범위에서 snippet 매칭 + main 영역 시각 분리.
 *
 * mainStart/mainEnd 와 매칭 영역 [matchStart, matchEnd) 의 경계점을 모두 모아
 * body 를 segment 로 쪼갠다. 각 segment 는:
 *   - main 영역 안 → text-foreground, 밖 → text-muted-foreground (dim 컨텍스트)
 *   - 매칭 영역 안 → <mark className="tw-highlight"> 추가
 *
 * dedup 으로 main 슬라이스 < snippet 인 경우에도 인접 영역까지 포함해 강조가
 * 보이도록 보장. 매칭 실패 시엔 단순히 main/외부 dim 만 적용 (이전 동작 유지).
 */
export function renderBodyWithHighlight(
  body: string,
  mainStart: number,
  mainEnd: number,
  snippet?: string,
): React.ReactNode {
  const range = snippet ? findFlexibleMatch(body, snippet) : null;
  const matchStart = range ? range[0] : -1;
  const matchEnd = range ? range[1] : -1;

  const boundaries = Array.from(
    new Set(
      [0, body.length, mainStart, mainEnd, matchStart, matchEnd].filter(
        (b) => b >= 0 && b <= body.length,
      ),
    ),
  ).sort((a, b) => a - b);

  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (start === end) continue;
    const slice = body.slice(start, end);
    const inMain = start >= mainStart && start < mainEnd;
    const inMatch = range !== null && start >= matchStart && start < matchEnd;

    let node: React.ReactNode = slice;
    if (inMatch) {
      node = <mark className="tw-highlight">{slice}</mark>;
    }
    if (!inMain) {
      node = (
        <span key={`seg-${start}`} className="text-muted-foreground">
          {node}
        </span>
      );
    } else {
      node = <React.Fragment key={`seg-${start}`}>{node}</React.Fragment>;
    }
    nodes.push(node);
  }
  return nodes;
}

// 정확 매칭 우선, 실패 시 snippet 의 whitespace 시퀀스를 \s+ 로 치환한 정규식으로 재시도.
export function findFlexibleMatch(
  text: string,
  snippet: string,
): [number, number] | null {
  const trimmed = snippet.trim();
  if (!trimmed) return null;

  const exact = text.indexOf(trimmed);
  if (exact >= 0) return [exact, exact + trimmed.length];

  const escaped = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const m = new RegExp(escaped).exec(text);
  if (m) return [m.index, m.index + m[0].length];

  return null;
}
