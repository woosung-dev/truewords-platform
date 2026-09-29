"use client";

// 원문 본문에서 고른 구절을 붙잡아 둔다 (API-HD-053). 선택이 자리 잡을 때(selectionchange 200ms 뒤, 손·키를 뗄 때)
// 한 번 계산해 상태로 쥔다 — 폰에서는 도구 버튼을 누르는 순간 선택이 풀리기 때문에 버튼은 살아 있는 선택이 아니라
// 이 상태를 쓴다. 도구를 누르는 중(hold)에 풀린 선택은 닫힘으로 보지 않는다.
import type { WordChunk } from "@truewords/api-client-ts/types";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { rangeToOffsets, sameRange, type TextRange } from "./highlight-range";

/** 떠 있는 도구의 기준 상자 — 본문 감싸개(position: relative) 기준 좌표다. 글과 함께 스크롤된다. */
export type Box = { top: number; bottom: number; left: number; right: number };
/** 첫 줄·마지막 줄 상자와 손가락 조작 여부. 손가락이면 도구를 선택 아래에 둔다(기본 선택 메뉴와 겹치지 않게). */
export type Anchor = { first: Box; last: Box; isTouch: boolean };

export function anchorFrom(rects: ArrayLike<DOMRect>, base: DOMRect, isTouch: boolean): Anchor {
  const boxes = Array.from(rects)
    .filter((rect) => rect.width > 0 || rect.height > 0)
    .map((rect) => ({
      top: rect.top - base.top,
      bottom: rect.bottom - base.top,
      left: rect.left - base.left,
      right: rect.right - base.left,
    }));
  const first = boxes[0];
  const last = boxes.at(-1);
  // 배치 정보가 없는 환경(jsdom 등)에서도 도구는 뜬다 — 감싸개 왼쪽 위에 둔다
  const empty = { top: 0, bottom: 0, left: 0, right: 0 };
  return { first: first ?? empty, last: last ?? empty, isTouch };
}

function rectsOf(range: Range): ArrayLike<DOMRect> {
  return typeof range.getClientRects === "function" ? range.getClientRects() : [];
}

export type PickedRange = { range: TextRange; anchor: Anchor };

type ChunkText = Pick<WordChunk, "chunk_id" | "chunk_index" | "display_text">;

const SETTLE_MS = 200;
const HOLD_MS = 800;

export function useTextSelection({
  rootRef,
  wrapRef,
  chunks,
}: {
  rootRef: RefObject<HTMLElement | null>;
  wrapRef: RefObject<HTMLElement | null>;
  chunks: ChunkText[];
}) {
  const [picked, setPicked] = useState<PickedRange | null>(null);
  const chunksRef = useRef(chunks);
  const isHolding = useRef(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const pointerType = useRef("");

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  const isTouch = useCallback(() => {
    if (pointerType.current) return pointerType.current !== "mouse";
    return window.matchMedia?.("(pointer: coarse)").matches ?? false;
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const drop = () => {
      if (!isHolding.current) setPicked(null);
    };
    const read = () => {
      const root = rootRef.current;
      const wrap = wrapRef.current;
      const selection = window.getSelection();
      if (!root || !wrap || !selection || selection.rangeCount === 0 || selection.isCollapsed) return drop();
      const range = selection.getRangeAt(0);
      // 두 끝이 모두 원문 안일 때만 — 화면 전체 선택(Ctrl+A)이나 머리글에서 시작한 선택은 형광펜 대상이 아니다
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return drop();
      const offsets = rangeToOffsets(range, root, chunksRef.current);
      if (!offsets) return drop();
      const anchor = anchorFrom(rectsOf(range), wrap.getBoundingClientRect(), isTouch());
      setPicked((previous) => (previous && sameRange(previous.range, offsets) ? previous : { range: offsets, anchor }));
    };
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, delay);
    };
    const onSettle = () => schedule(SETTLE_MS);
    const onRelease = () => schedule(10);
    const onPointerDown = (event: PointerEvent) => {
      pointerType.current = event.pointerType;
    };
    document.addEventListener("selectionchange", onSettle);
    document.addEventListener("mouseup", onRelease);
    document.addEventListener("touchend", onRelease);
    document.addEventListener("keyup", onRelease);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onSettle);
      document.removeEventListener("mouseup", onRelease);
      document.removeEventListener("touchend", onRelease);
      document.removeEventListener("keyup", onRelease);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [rootRef, wrapRef, isTouch]);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  /** 도구를 누르기 시작했다 — 이 누름 때문에 선택이 풀려도 도구를 닫지 않는다. */
  const hold = useCallback(() => {
    isHolding.current = true;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      isHolding.current = false;
    }, HOLD_MS);
  }, []);

  /** 도구를 닫고 화면의 선택도 지운다(복사·칠하기·Esc 뒤). */
  const release = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setPicked(null);
  }, []);

  const dismiss = useCallback(() => setPicked(null), []);

  return { picked, hold, release, dismiss, isTouch };
}
