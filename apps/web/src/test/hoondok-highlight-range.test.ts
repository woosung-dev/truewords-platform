// 구절 형광펜(API-HD-053) 순수 계산 — 문단 위치, 공백 다듬기, 여러 단락에 걸친 구간, 겹침 순위,
// 다시 붙이기(re-anchor), 그리고 DOM 선택 → 청크 오프셋 변환을 본다.
import type { HighlightItem } from "@truewords/api-client-ts/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  anchorHighlights,
  findWholeChunkHighlight,
  inReadingOrder,
  rangeToOffsets,
  segmentChunk,
  splitParagraphs,
  trimRange,
  wholeChunkRange,
} from "@/features/hoondok/library/highlight-range";

function item(overrides: Partial<HighlightItem>): HighlightItem {
  return {
    id: "h1",
    volume: "v",
    chunk_id: "c0",
    start_chunk_index: 0,
    start_offset: 0,
    end_chunk_index: 0,
    end_offset: 1,
    quote: "",
    color: 1,
    note: null,
    created_at: "2026-09-29T00:00:00Z",
    updated_at: "2026-09-29T00:00:00Z",
    work_title: "말씀선집 001권",
    label: "001권",
    ...overrides,
  };
}

describe("문단 나누기", () => {
  it('"\\n\\n" 으로 나누되 display_text 안 위치를 지킨다', () => {
    expect(splitParagraphs("첫 문단\n\n둘째 문단")).toEqual([
      { start: 0, end: 4, text: "첫 문단" },
      { start: 6, end: 11, text: "둘째 문단" },
    ]);
  });
  it("빈 문단은 빼지만 뒤 문단의 위치는 그대로다", () => {
    expect(splitParagraphs("가\n\n\n\n나")).toEqual([
      { start: 0, end: 1, text: "가" },
      { start: 5, end: 6, text: "나" },
    ]);
  });
});

describe("구간 다듬기", () => {
  const chunks = [
    { chunk_id: "c0", chunk_index: 4, display_text: "  첫 문장의 앞 " },
    { chunk_id: "c1", chunk_index: 5, display_text: " 부분이 이어진다." },
  ];
  it("앞뒤 공백을 빼고 인용은 display_text 조각으로 만든다", () => {
    expect(trimRange(chunks, { chunkIndex: 4, offset: 0 }, { chunkIndex: 4, offset: 99 })).toEqual({
      chunkId: "c0",
      startChunkIndex: 4,
      startOffset: 2,
      endChunkIndex: 4,
      endOffset: 9,
      quote: "첫 문장의 앞",
    });
  });
  it("여러 단락에 걸치면 시작 단락 id 를 쓰고 인용을 줄바꿈으로 잇는다", () => {
    expect(trimRange(chunks, { chunkIndex: 4, offset: 4 }, { chunkIndex: 5, offset: 4 })).toEqual({
      chunkId: "c0",
      startChunkIndex: 4,
      startOffset: 4,
      endChunkIndex: 5,
      endOffset: 4,
      quote: "문장의 앞 \n 부분이",
    });
  });
  it("단락 끝에서 시작하면 다음 단락의 첫 글자로 넘어간다", () => {
    expect(trimRange(chunks, { chunkIndex: 4, offset: 11 }, { chunkIndex: 5, offset: 4 })).toMatchObject({
      chunkId: "c1",
      startChunkIndex: 5,
      startOffset: 1,
      quote: "부분이",
    });
  });
  it("공백만 골랐으면 없다", () => {
    expect(trimRange(chunks, { chunkIndex: 4, offset: 10 }, { chunkIndex: 5, offset: 1 })).toBeNull();
  });
  it("단락 전체 구간은 앞뒤 공백을 뺀다", () => {
    expect(wholeChunkRange(chunks[0])).toMatchObject({ startOffset: 2, endOffset: 9, quote: "첫 문장의 앞" });
    expect(wholeChunkRange({ chunk_id: "e", chunk_index: 0, display_text: "  \n\n " })).toBeNull();
  });
  it("단락 전체 형광펜만 찾고 부분 구절은 건너뛴다", () => {
    const whole = item({ id: "whole", start_chunk_index: 4, end_chunk_index: 4, start_offset: 2, end_offset: 9 });
    const part = item({ id: "part", start_chunk_index: 4, end_chunk_index: 4, start_offset: 2, end_offset: 5 });
    expect(findWholeChunkHighlight([part, whole], chunks[0])?.id).toBe("whole");
    expect(findWholeChunkHighlight([part], chunks[0])).toBeUndefined();
  });
});

describe("본문에 그리기", () => {
  const chunk = { chunk_id: "c0", chunk_index: 0, display_text: "가나다라마바" };
  it("겹치면 최근에 바뀐 형광펜 색이 이긴다", () => {
    const older = item({ id: "a", start_offset: 0, end_offset: 4, quote: "가나다라", color: 1 });
    const newer = item({
      id: "b",
      start_offset: 2,
      end_offset: 6,
      quote: "다라마바",
      color: 2,
      updated_at: "2026-09-29T01:00:00Z",
    });
    const decorations = anchorHighlights([newer, older], [chunk]).get(0) ?? [];
    const [{ segments }] = segmentChunk(chunk.display_text, decorations);
    expect(segments.map((segment) => [segment.text, segment.highlight?.id])).toEqual([
      ["가나", "a"],
      ["다라마바", "b"],
    ]);
    // 오래된 쪽을 다시 칠하면(updated_at 이 뒤) 겹친 부분 색이 바뀐다
    const recolored = { ...older, updated_at: "2026-09-29T02:00:00Z" };
    const [{ segments: again }] = segmentChunk(
      chunk.display_text,
      anchorHighlights([newer, recolored], [chunk]).get(0) ?? [],
    );
    expect(again.map((segment) => [segment.text, segment.highlight?.id])).toEqual([
      ["가나다라", "a"],
      ["마바", "b"],
    ]);
  });
  it("오프셋 글자가 인용과 다르면 인용을 다시 찾아 붙이고, 없으면 그리지 않는다", () => {
    const moved = item({ id: "moved", start_offset: 0, end_offset: 2, quote: "다라" });
    const gone = item({ id: "gone", start_offset: 0, end_offset: 2, quote: "없는말" });
    const decorations = anchorHighlights([moved, gone], [chunk]).get(0) ?? [];
    expect(decorations).toEqual([expect.objectContaining({ id: "moved", start: 2, end: 4 })]);
  });
  it("여러 단락에 걸친 형광펜은 단락 길이로 자르고 이 페이지에 없는 단락은 건너뛴다", () => {
    const chunks = [
      { chunk_id: "c0", chunk_index: 0, display_text: "앞 단락" },
      { chunk_id: "c1", chunk_index: 1, display_text: "뒤 단락" },
    ];
    const span = item({
      start_chunk_index: 0,
      start_offset: 2,
      end_chunk_index: 2,
      end_offset: 99,
      quote: "단락\n뒤 단락\n…",
      note: "메모",
    });
    const map = anchorHighlights([span], chunks);
    expect(map.get(0)).toEqual([expect.objectContaining({ start: 2, end: 4, memoAt: undefined })]);
    expect(map.get(1)).toEqual([expect.objectContaining({ start: 0, end: 4, memoAt: undefined })]);
  });
  it("검색어·카드 밑줄과 형광펜을 겹치지 않는 조각으로 합치고 메모 표지는 형광펜 끝에 붙인다", () => {
    const text = "첫 문단 끝\n\n둘째 문단";
    const decorations = [
      { kind: "highlight" as const, start: 2, end: 10, id: "h", color: 3 as const, rank: 0, memoAt: 10 },
      { kind: "search" as const, start: 0, end: 1 },
    ];
    const [first, second] = segmentChunk(text, decorations);
    expect(first.segments.map((segment) => [segment.text, segment.highlight?.id ?? null, segment.isSearchHit])).toEqual(
      [
        ["첫", null, true],
        [" ", null, false],
        ["문단 끝", "h", false],
      ],
    );
    expect(second.paragraph.start).toBe(8);
    expect(second.segments.map((segment) => [segment.text, segment.memoAfter])).toEqual([
      ["둘째", ["h"]],
      [" 문단", []],
    ]);
  });
  it("노트 목록은 본문 순서다", () => {
    const later = item({ id: "later", start_chunk_index: 3, start_offset: 0 });
    const early = item({ id: "early", start_chunk_index: 1, start_offset: 9 });
    const earliest = item({ id: "earliest", start_chunk_index: 1, start_offset: 2 });
    expect(inReadingOrder([later, early, earliest]).map((entry) => entry.id)).toEqual(["earliest", "early", "later"]);
  });
});

describe("DOM 선택 → 청크 오프셋", () => {
  const CHUNKS = [
    { chunk_id: "c0", chunk_index: 0, display_text: "첫 문단 끝\n\n둘째" },
    { chunk_id: "c1", chunk_index: 1, display_text: "다음 단락" },
  ];
  // 원문 뷰 Verse 와 같은 모양: 번호 버튼(여백) + 문단 span(data-start). 형광펜 mark 와 메모 표지([data-hl-ui])가 섞여 있다.
  function mount() {
    document.body.innerHTML = `
      <article>
        <p class="verse" data-chunk-index="0" data-chunk-id="c0"><button class="verse__n">1</button><span class="verse__tx"><span class="verse__para" data-start="0">첫 <mark class="hl hl-1" data-hl-id="h1">문단</mark><button data-hl-ui="" data-hl-memo="h1">메모 보기</button> 끝</span><span class="verse__para" data-start="8">둘째</span></span></p>
        <p class="verse" data-chunk-index="1" data-chunk-id="c1"><button class="verse__n">2</button><span class="verse__tx"><span class="verse__para" data-start="0">다음 단락</span></span></p>
      </article>`;
    const root = document.querySelector("article") as HTMLElement;
    const paras = root.querySelectorAll(".verse__para");
    return { root, paras, numbers: root.querySelectorAll(".verse__n") };
  }
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("형광펜 mark 안에서 시작해 메모 표지 뒤에서 끝나도 표지는 글자로 세지 않는다", () => {
    const { root, paras } = mount();
    const markText = paras[0].querySelector("mark")?.firstChild as Text;
    const tail = paras[0].lastChild as Text; // " 끝"
    const range = document.createRange();
    range.setStart(markText, 1);
    range.setEnd(tail, 2);
    expect(rangeToOffsets(range, root, CHUNKS)).toEqual({
      chunkId: "c0",
      startChunkIndex: 0,
      startOffset: 3,
      endChunkIndex: 0,
      endOffset: 6,
      quote: "단 끝",
    });
  });
  it("번호 여백에서 시작하면 그 단락 처음부터, 다음 단락까지 이어 고른다", () => {
    const { root, paras, numbers } = mount();
    const range = document.createRange();
    range.setStart(numbers[0], 0);
    range.setEnd(paras[2].firstChild as Text, 2);
    expect(rangeToOffsets(range, root, CHUNKS)).toEqual({
      chunkId: "c0",
      startChunkIndex: 0,
      startOffset: 0,
      endChunkIndex: 1,
      endOffset: 2,
      quote: "첫 문단 끝\n\n둘째\n다음",
    });
  });
  it("다음 단락 번호 여백에서 끝나면 앞 단락 끝까지다", () => {
    const { root, paras, numbers } = mount();
    const range = document.createRange();
    range.setStart(paras[1].firstChild as Text, 1);
    range.setEnd(numbers[1].firstChild as Text, 1);
    expect(rangeToOffsets(range, root, CHUNKS)).toMatchObject({
      startChunkIndex: 0,
      startOffset: 9,
      endChunkIndex: 0,
      endOffset: 10,
      quote: "째",
    });
  });
  it("문단 경계(요소 자식 위치)로 들어온 선택도 같은 오프셋이 된다", () => {
    const { root, paras } = mount();
    const range = document.createRange();
    range.setStart(paras[0], 1); // "첫 " 다음 = mark 앞
    range.setEnd(paras[0], 2); // mark 뒤
    expect(rangeToOffsets(range, root, CHUNKS)).toMatchObject({ startOffset: 2, endOffset: 4, quote: "문단" });
  });
  it("공백·번호만 고르면 구간이 없다", () => {
    const { root, paras, numbers } = mount();
    const spaces = document.createRange();
    spaces.setStart(paras[0].firstChild as Text, 1);
    spaces.setEnd(paras[0].firstChild as Text, 2);
    expect(rangeToOffsets(spaces, root, CHUNKS)).toBeNull();
    const number = document.createRange();
    number.selectNodeContents(numbers[0]);
    expect(rangeToOffsets(number, root, CHUNKS)).toBeNull();
  });
});
