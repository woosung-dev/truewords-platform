"use client";

// 원문 연결 (PLAN-HD-012): /hoondok/words/{volume}?chunk_id=…&card={id}.
// 카드 문장을 단락 display_text 안에서 느슨하게 찾아(match.ts) 밑줄을 긋고 왼쪽 여백에 감귤 리본 끈을 그린다.
// 못 찾으면 단락 전체를 강조한다. 들어올 때 원문 펼침 모션(쪽 → 리본 끈 → 밑줄), 나갈 때 리본이 걷힌다.
import { useQuery } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isHoondokCardsEnabled } from "../../flag";
import { type CardPublic, cardsAPI } from "../api";
import { findCardSentence } from "../match";
import {
  clearAnimations,
  type MotionTarget,
  pageSteps,
  playSteps,
  prefersReducedMotion,
  pulloutExitSteps,
} from "../motion";
import { cardPath } from "../share";

/** card 파라미터가 가리키는 카드. 인용 단락(chunk_id)과 같은 카드일 때만 쓴다 — 아니면 밑줄 없이 평소 원문이다. */
export function useWordsCard(cardId: string | undefined, chunkId: string | undefined) {
  const isEnabled = isHoondokCardsEnabled() && Boolean(cardId) && Boolean(chunkId);
  const card = useQuery({
    queryKey: ["hoondok", "cards", "one", cardId ?? null],
    queryFn: () => cardsAPI.get(cardId ?? ""),
    enabled: isEnabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const today = useQuery({
    queryKey: ["hoondok", "cards", "today"],
    queryFn: cardsAPI.today,
    enabled: isEnabled,
    retry: false,
  });
  const data = card.data && card.data.chunk_id === chunkId ? card.data : null;
  return { card: data, isToday: Boolean(data && today.data?.card?.id === data.id) };
}

export type MarkedParagraph = { key: number; parts: { text: string; isMarked: boolean }[] };

/** display_text 를 문단("\n\n")으로 나누고 카드 문장 범위를 문단별 조각으로 자른다. 못 찾으면 isMatched=false. */
export function markParagraphs(
  displayText: string,
  cardText: string,
): { paragraphs: MarkedParagraph[]; isMatched: boolean } {
  const text = displayText.normalize("NFC");
  const range = findCardSentence(text, cardText);
  const paragraphs: MarkedParagraph[] = [];
  let offset = 0;
  for (const paragraph of text.split("\n\n")) {
    const start = offset;
    const end = start + paragraph.length;
    offset = end + 2;
    if (!paragraph) continue;
    const from = range ? Math.max(range.start, start) : end;
    const to = range ? Math.min(range.end, end) : end;
    const parts =
      from < to
        ? [
            { text: text.slice(start, from), isMarked: false },
            { text: text.slice(from, to), isMarked: true },
            { text: text.slice(to, end), isMarked: false },
          ].filter((part) => part.text)
        : [{ text: paragraph, isMarked: false }];
    paragraphs.push({ key: start, parts });
  }
  return { paragraphs, isMatched: Boolean(range) };
}

type Line = { left: number; top: number; width: number };

/**
 * 밑줄 막대·리본 끈. 밑줄은 여러 줄에 걸친 인라인 글자라 줄마다 막대를 따로 그린다(getClientRects).
 * 들어오는 모션은 한 번만 재생한다(쪽 translateY+opacity → 리본 scaleY → 밑줄 scaleX).
 */
export function CardMarkOverlay({
  verseRef,
  isMatched,
  ribbonRef,
}: {
  verseRef: RefObject<HTMLElement | null>;
  isMatched: boolean;
  ribbonRef: RefObject<HTMLSpanElement | null>;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [ribbonHeight, setRibbonHeight] = useState<number | null>(null);
  const linesRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const verse = verseRef.current;
    if (!verse) return;
    const measure = () => {
      const base = verse.getBoundingClientRect();
      const rects = isMatched
        ? Array.from(verse.querySelectorAll(".wd-card-ul")).flatMap((span) => Array.from(span.getClientRects()))
        : [];
      setLines(
        rects.map((rect) => ({ left: rect.left - base.left, top: rect.bottom - base.top + 2, width: rect.width })),
      );
      const bottom = rects.length ? Math.max(...rects.map((rect) => rect.bottom)) - base.top : base.height;
      setRibbonHeight(bottom + 42);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(verse);
    return () => observer.disconnect();
  }, [verseRef, isMatched]);

  const hasPlayed = useRef(false);
  useLayoutEffect(() => {
    if (hasPlayed.current || ribbonHeight === null) return;
    hasPlayed.current = true;
    const targets: Partial<Record<MotionTarget, Element | null>> = {
      page: verseRef.current,
      ribbon: ribbonRef.current,
      underline: linesRef.current,
    };
    void playSteps(pageSteps(prefersReducedMotion()), (target) => targets[target]).then(() => {
      clearAnimations(verseRef.current);
    });
  }, [ribbonHeight, verseRef, ribbonRef]);

  return (
    <>
      <span
        className="wd-card-rib"
        ref={ribbonRef}
        aria-hidden="true"
        style={ribbonHeight === null ? undefined : { height: `${ribbonHeight}px` }}
      />
      <span className="wd-card-lines" ref={linesRef} aria-hidden="true">
        {lines.map((line) => (
          <i key={`${line.top}:${line.left}`} style={{ left: line.left, top: line.top, width: line.width }} />
        ))}
      </span>
    </>
  );
}

/** 단락 아래 행동: 오늘 카드면 "책갈피 다시 꺼내기"(리본이 걷힌 뒤 읽기로), 다른 날 카드면 그 카드 화면으로. */
export function CardPulloutBar({
  card,
  isToday,
  ribbonRef,
}: {
  card: CardPublic;
  isToday: boolean;
  ribbonRef: RefObject<HTMLSpanElement | null>;
}) {
  const router = useRouter();
  const href = isToday ? "/hoondok/bookmark?from=words" : cardPath(card.id);
  async function handleClick() {
    await playSteps(pulloutExitSteps(prefersReducedMotion()), (target) =>
      target === "ribbon" ? ribbonRef.current : null,
    );
    router.push(href);
  }
  return (
    <div className="wd-card-act">
      <button className="btn btn-line" type="button" onClick={() => void handleClick()}>
        <ArrowUp size={20} aria-hidden="true" />
        {isToday ? "책갈피 다시 꺼내기" : "책갈피로 돌아가기"}
      </button>
    </div>
  );
}

/** Verse 가 카드 단락일 때 쓰는 문단 조각. 표시 텍스트는 그대로, 밑줄 범위만 span 으로 감싼다. */
export function useMarkedParagraphs(displayText: string, cardText: string | null | undefined) {
  return useMemo(() => (cardText ? markParagraphs(displayText, cardText) : null), [displayText, cardText]);
}
