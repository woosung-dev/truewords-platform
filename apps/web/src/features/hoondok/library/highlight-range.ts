// 구절 형광펜(API-HD-053)의 순수 계산. 화면 컴포넌트는 이 모듈이 준 구간·조각을 그리기만 한다.
// 오프셋은 청크 `display_text` 안의 글자 위치이고 끝은 배타다. 한 구절은 여러 청크에 걸칠 수 있다
// (청킹이 문장 중간을 자르기 때문). 사람에게 보이는 단락 = 청크, 문단 = display_text 의 "\n\n" 조각이다.
import type { HighlightInput, HighlightItem, WordChunk } from "@truewords/api-client-ts/types";

export const HIGHLIGHT_COLORS = [1, 2, 3] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
/** 색 이름 (DES-PWA-003 §1.1 --hl-1·2·3). 색만으로 구분하지 않도록 목록·버튼 이름에 함께 쓴다(§3.3). */
export const COLOR_NAME: Record<HighlightColor, string> = { 1: "노랑", 2: "초록", 3: "분홍" };
/** 서버 `quote` 상한 (HighlightInput.quote max_length) */
export const MAX_QUOTE = 4000;
/** 서버 `note` 상한 (HighlightInput.note max_length) */
export const MAX_NOTE = 2000;

export function toHighlightColor(value: number | null | undefined): HighlightColor {
  return value === 2 || value === 3 ? value : 1;
}

type ChunkText = Pick<WordChunk, "chunk_id" | "chunk_index" | "display_text">;

export type Paragraph = { start: number; end: number; text: string };

/** display_text 를 문단("\n\n")으로 나누되 원래 위치를 지킨다. 빈 문단은 그리지 않으므로 뺀다. */
export function splitParagraphs(displayText: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let offset = 0;
  for (const text of displayText.split("\n\n")) {
    const start = offset;
    offset = start + text.length + 2;
    if (text) paragraphs.push({ start, end: start + text.length, text });
  }
  return paragraphs;
}

/** 사용자가 고른 구절. `chunkId` 는 시작 청크 id 다(원문 링크 `?chunk_id=` 에 쓴다). */
export type TextRange = {
  chunkId: string;
  startChunkIndex: number;
  startOffset: number;
  endChunkIndex: number;
  endOffset: number;
  quote: string;
};

export function highlightInput(volume: string, range: TextRange, color: HighlightColor, note?: string | null) {
  const input: HighlightInput = {
    volume,
    chunk_id: range.chunkId,
    start_chunk_index: range.startChunkIndex,
    start_offset: range.startOffset,
    end_chunk_index: range.endChunkIndex,
    end_offset: range.endOffset,
    quote: range.quote,
    color,
  };
  if (note) input.note = note;
  return input;
}

/** 되돌리기(지운 형광펜 다시 만들기)는 메모까지 같은 값으로 다시 보낸다. */
export function inputFromItem(item: HighlightItem): HighlightInput {
  return {
    volume: item.volume,
    chunk_id: item.chunk_id,
    start_chunk_index: item.start_chunk_index,
    start_offset: item.start_offset,
    end_chunk_index: item.end_chunk_index,
    end_offset: item.end_offset,
    quote: item.quote,
    color: item.color,
    note: item.note,
  };
}

export function sameRange(a: TextRange, b: TextRange): boolean {
  return (
    a.startChunkIndex === b.startChunkIndex &&
    a.startOffset === b.startOffset &&
    a.endChunkIndex === b.endChunkIndex &&
    a.endOffset === b.endOffset
  );
}

const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

/** 단락(청크) 전체 구간 — 앞뒤 공백을 뺀다. 칠할 글자가 없으면 null. "단락 전체 칠하기" 가 쓴다. */
export function wholeChunkRange(chunk: ChunkText): TextRange | null {
  const text = chunk.display_text;
  let start = 0;
  let end = text.length;
  while (start < end && isSpace(text[start])) start += 1;
  while (end > start && isSpace(text[end - 1])) end -= 1;
  if (start >= end) return null;
  return {
    chunkId: chunk.chunk_id,
    startChunkIndex: chunk.chunk_index,
    startOffset: start,
    endChunkIndex: chunk.chunk_index,
    endOffset: end,
    quote: text.slice(start, end),
  };
}

/** 이 단락 전체를 칠한 형광펜(가장 최근 것). 부분 구절 형광펜은 해당하지 않는다. */
export function findWholeChunkHighlight(items: HighlightItem[], chunk: ChunkText): HighlightItem | undefined {
  const range = wholeChunkRange(chunk);
  if (!range) return undefined;
  return byUpdatedDesc(
    items.filter(
      (item) =>
        item.start_chunk_index === chunk.chunk_index &&
        item.end_chunk_index === chunk.chunk_index &&
        item.start_offset === range.startOffset &&
        item.end_offset === range.endOffset,
    ),
  )[0];
}

function timeOf(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function byUpdatedDesc(items: HighlightItem[]): HighlightItem[] {
  return [...items].sort((a, b) => timeOf(b.updated_at) - timeOf(a.updated_at));
}

/** 노트 탭 목록 순서 — 본문 순서(시작 단락, 시작 글자). */
export function inReadingOrder(items: HighlightItem[]): HighlightItem[] {
  return [...items].sort((a, b) => a.start_chunk_index - b.start_chunk_index || a.start_offset - b.start_offset);
}

/** 원문에 그릴 꾸밈 한 조각. 형광펜 외에 검색어 밑줄·책갈피 카드 밑줄도 같은 구간으로 합친다. */
export type Decoration =
  | {
      kind: "highlight";
      start: number;
      end: number;
      id: string;
      color: HighlightColor;
      /** 겹칠 때 색을 정하는 순위 — 최근에 바뀐 형광펜이 크다 */
      rank: number;
      /** 이 청크에서 끝나는 메모 있는 형광펜이면 끝 위치(메모 표지를 그 뒤에 둔다) */
      memoAt?: number;
    }
  | { kind: "search" | "card"; start: number; end: number };

/**
 * 형광펜을 이 페이지 청크별 구간으로 옮긴다. 한 청크 안 형광펜은 오프셋 글자가 `quote` 와 다르면
 * (서버 표시 텍스트 정리가 바뀐 경우) `quote` 를 다시 찾아 붙이고, 못 찾으면 본문에 그리지 않는다(노트 목록에는 남는다).
 * 여러 청크에 걸친 형광펜은 각 청크 길이로 잘라 그린다.
 */
export function anchorHighlights(items: HighlightItem[], chunks: ChunkText[]): Map<number, Decoration[]> {
  const byIndex = new Map(chunks.map((chunk) => [chunk.chunk_index, chunk]));
  const ranked = [...items].sort(
    (a, b) => timeOf(a.updated_at) - timeOf(b.updated_at) || timeOf(a.created_at) - timeOf(b.created_at),
  );
  const result = new Map<number, Decoration[]>();
  const push = (chunkIndex: number, decoration: Decoration) => {
    const list = result.get(chunkIndex);
    if (list) list.push(decoration);
    else result.set(chunkIndex, [decoration]);
  };
  ranked.forEach((item, rank) => {
    const color = toHighlightColor(item.color);
    const hasMemo = Boolean(item.note?.trim());
    if (item.start_chunk_index === item.end_chunk_index) {
      const chunk = byIndex.get(item.start_chunk_index);
      if (!chunk) return;
      const text = chunk.display_text;
      let start = item.start_offset;
      let end = item.end_offset;
      if (text.slice(start, end) !== item.quote) {
        const found = item.quote ? text.indexOf(item.quote) : -1;
        if (found < 0) return;
        start = found;
        end = found + item.quote.length;
      }
      push(chunk.chunk_index, {
        kind: "highlight",
        start,
        end,
        id: item.id,
        color,
        rank,
        memoAt: hasMemo ? end : undefined,
      });
      return;
    }
    for (let index = item.start_chunk_index; index <= item.end_chunk_index; index += 1) {
      const chunk = byIndex.get(index);
      if (!chunk) continue;
      const length = chunk.display_text.length;
      const start = index === item.start_chunk_index ? Math.min(item.start_offset, length) : 0;
      const end = index === item.end_chunk_index ? Math.min(item.end_offset, length) : length;
      if (start >= end) continue;
      const isLast = index === item.end_chunk_index;
      push(index, {
        kind: "highlight",
        start,
        end,
        id: item.id,
        color,
        rank,
        memoAt: hasMemo && isLast ? end : undefined,
      });
    }
  });
  return result;
}

/** 조각 배열(검색어·카드 밑줄 도우미가 만든 것)을 구간으로 바꾼다. `start` 는 첫 조각의 display_text 위치다. */
export function partsToRanges<T extends { text: string }>(
  start: number,
  parts: T[],
  isOn: (part: T) => boolean,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let offset = start;
  for (const part of parts) {
    if (isOn(part) && part.text) ranges.push({ start: offset, end: offset + part.text.length });
    offset += part.text.length;
  }
  return ranges;
}

export type Segment = {
  start: number;
  end: number;
  text: string;
  highlight: { id: string; color: HighlightColor } | null;
  isSearchHit: boolean;
  isCardMark: boolean;
  /** 이 조각 바로 뒤에 둘 메모 표지(형광펜 id) */
  memoAfter: string[];
};

/**
 * 한 청크를 문단별로 겹치지 않는 조각으로 나눈다. 형광펜이 겹치면 순위(rank)가 큰 쪽 색을 쓴다.
 * 메모 표지는 형광펜 끝이 들어 있는 문단에 두고, 문단 사이 틈에 떨어지면 바로 앞 문단 끝에 붙인다.
 */
export function segmentChunk(
  displayText: string,
  decorations: Decoration[],
): { paragraph: Paragraph; segments: Segment[] }[] {
  const paragraphs = splitParagraphs(displayText);
  const markers = paragraphs.map(() => [] as { id: string; at: number }[]);
  for (const decoration of decorations) {
    if (decoration.kind !== "highlight" || decoration.memoAt === undefined) continue;
    const at = decoration.memoAt;
    let owner = paragraphs.findIndex((paragraph) => paragraph.start < at && at <= paragraph.end);
    if (owner < 0) owner = paragraphs.findLastIndex((paragraph) => paragraph.end < at);
    if (owner < 0) owner = 0;
    const paragraph = paragraphs[owner];
    if (paragraph)
      markers[owner].push({ id: decoration.id, at: Math.min(Math.max(at, paragraph.start), paragraph.end) });
  }
  return paragraphs.map((paragraph, index) => ({
    paragraph,
    segments: segmentParagraph(paragraph, decorations, markers[index]),
  }));
}

function segmentParagraph(
  paragraph: Paragraph,
  decorations: Decoration[],
  markers: { id: string; at: number }[],
): Segment[] {
  const { start: from, end: to } = paragraph;
  const cuts = new Set([from, to]);
  for (const decoration of decorations) {
    if (decoration.start > from && decoration.start < to) cuts.add(decoration.start);
    if (decoration.end > from && decoration.end < to) cuts.add(decoration.end);
  }
  for (const marker of markers) if (marker.at > from && marker.at < to) cuts.add(marker.at);
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const covering = decorations.filter((decoration) => decoration.start <= start && end <= decoration.end);
    let top: Extract<Decoration, { kind: "highlight" }> | null = null;
    for (const decoration of covering) {
      if (decoration.kind === "highlight" && (!top || decoration.rank > top.rank)) top = decoration;
    }
    const segment: Segment = {
      start,
      end,
      text: paragraph.text.slice(start - from, end - from),
      highlight: top ? { id: top.id, color: top.color } : null,
      isSearchHit: covering.some((decoration) => decoration.kind === "search"),
      isCardMark: covering.some((decoration) => decoration.kind === "card"),
      memoAfter: [],
    };
    const previous = segments.at(-1);
    const isSameLook =
      previous &&
      previous.memoAfter.length === 0 &&
      previous.highlight?.id === segment.highlight?.id &&
      previous.isSearchHit === segment.isSearchHit &&
      previous.isCardMark === segment.isCardMark;
    if (previous && isSameLook) {
      previous.end = end;
      previous.text += segment.text;
    } else segments.push(segment);
  }
  for (const marker of markers) {
    const owner = segments.find((segment) => segment.end >= marker.at) ?? segments.at(-1);
    owner?.memoAfter.push(marker.id);
  }
  return segments;
}

// --- DOM 선택 → 청크 오프셋 -------------------------------------------------------------
// 원문 마크업 약속: 단락 <p data-chunk-index data-chunk-id> 안의 문단 <span class="verse__para" data-start>.
// 문단 span 의 글자는 display_text.slice(start, end) 그대로이고, 그 안의 `[data-hl-ui]`(메모 표지 등)는 글자로 세지 않는다.

export const PARA_SELECTOR = ".verse__para";
const UI_SELECTOR = "[data-hl-ui]";

/** 조각 안 보이는 글자 수 — 형광펜 UI(`[data-hl-ui]`)는 뺀다. */
function textLengthOf(fragment: DocumentFragment): number {
  for (const element of fragment.querySelectorAll(UI_SELECTOR)) element.remove();
  return fragment.textContent?.length ?? 0;
}

/** 문단 시작부터 (node, offset) 경계까지의 글자 수. 경계가 문단 밖이면 null. */
function offsetInParagraph(paragraph: Element, node: Node, offset: number): number | null {
  if (!paragraph.contains(node)) return null;
  const range = paragraph.ownerDocument.createRange();
  range.selectNodeContents(paragraph);
  range.setEnd(node, offset);
  return textLengthOf(range.cloneContents());
}

function paragraphLength(paragraph: Element): number {
  const range = paragraph.ownerDocument.createRange();
  range.selectNodeContents(paragraph);
  return textLengthOf(range.cloneContents());
}

function positionOf(paragraph: Element, inner: number): { chunkIndex: number; offset: number } | null {
  const verse = paragraph.closest<HTMLElement>("[data-chunk-index]");
  const chunkIndex = Number(verse?.dataset.chunkIndex);
  const start = Number((paragraph as HTMLElement).dataset.start);
  if (!Number.isInteger(chunkIndex) || !Number.isInteger(start)) return null;
  return { chunkIndex, offset: start + inner };
}

/**
 * DOM 선택 구간을 청크 오프셋으로 바꾼다. 구간이 걸친 문단 중 첫 문단의 시작 경계(경계가 번호 여백처럼
 * 문단 밖이면 그 문단 처음)부터 마지막 문단의 끝 경계(밖이면 그 문단 끝)까지다. 앞뒤 공백은 뺀다.
 * 인용(quote)은 선택 글자가 아니라 display_text 조각으로 만든다 — 여러 청크면 "\n" 으로 잇는다.
 */
export function rangeToOffsets(range: Range, root: Element, chunks: ChunkText[]): TextRange | null {
  const paragraphs = Array.from(root.querySelectorAll(PARA_SELECTOR)).filter((paragraph) =>
    range.intersectsNode(paragraph),
  );
  const first = paragraphs[0];
  const last = paragraphs.at(-1);
  if (!first || !last) return null;
  const startInner = offsetInParagraph(first, range.startContainer, range.startOffset) ?? 0;
  const endInner = offsetInParagraph(last, range.endContainer, range.endOffset) ?? paragraphLength(last);
  const start = positionOf(first, startInner);
  const end = positionOf(last, endInner);
  if (!start || !end) return null;
  return trimRange(chunks, start, end);
}

type Point = { at: number; offset: number };

/** (청크, 오프셋) 두 점을 공백 없는 구간으로 좁히고 인용을 만든다. `chunks` 는 페이지 순서다. */
export function trimRange(
  chunks: ChunkText[],
  start: { chunkIndex: number; offset: number },
  end: { chunkIndex: number; offset: number },
): TextRange | null {
  const texts = chunks.map((chunk) => chunk.display_text);
  const at = (chunkIndex: number) => chunks.findIndex((chunk) => chunk.chunk_index === chunkIndex);
  const clamp = (point: { chunkIndex: number; offset: number }): Point | null => {
    const index = at(point.chunkIndex);
    if (index < 0) return null;
    return { at: index, offset: Math.min(Math.max(point.offset, 0), texts[index].length) };
  };
  const from = clamp(start);
  const to = clamp(end);
  if (!from || !to) return null;
  const isBefore = (a: Point, b: Point) => a.at < b.at || (a.at === b.at && a.offset < b.offset);
  while (isBefore(from, to)) {
    if (from.offset >= texts[from.at].length) {
      from.at += 1;
      from.offset = 0;
    } else if (isSpace(texts[from.at][from.offset])) from.offset += 1;
    else break;
  }
  while (isBefore(from, to)) {
    if (to.offset <= 0) {
      to.at -= 1;
      to.offset = texts[to.at].length;
    } else if (isSpace(texts[to.at][to.offset - 1])) to.offset -= 1;
    else break;
  }
  if (!isBefore(from, to)) return null;
  const pieces: string[] = [];
  for (let index = from.at; index <= to.at; index += 1) {
    const text = texts[index];
    pieces.push(text.slice(index === from.at ? from.offset : 0, index === to.at ? to.offset : text.length));
  }
  return {
    chunkId: chunks[from.at].chunk_id,
    startChunkIndex: chunks[from.at].chunk_index,
    startOffset: from.offset,
    endChunkIndex: chunks[to.at].chunk_index,
    endOffset: to.offset,
    quote: pieces.join("\n"),
  };
}
