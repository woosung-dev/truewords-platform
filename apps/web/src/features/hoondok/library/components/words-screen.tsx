"use client";

// SCR-PWA-009 원문 뷰. PLAN-HD-007 로 장 목차(API-HD-024)·이어 읽기(API-HD-025)·
// AI 설명(§2-7)이 붙었다. 단락 단위는 Qdrant 청크다(§2-12).
// PLAN-HD-008 로 표시 텍스트(display_text)·브라우저 음성 듣기(../tts)가 더해졌다.
// PLAN-HD-011 로 듣기는 AI 목소리(단락 mp3)가 기본이고 브라우저 음성은 대체 경로다.
// API-HD-053 로 형광펜·메모는 사용자가 고른 구절 단위다. 본문을 눌러 단락 시트를 여는 경로는 없앴다 — 글자 선택과
// 다툰다. 단락 시트는 번호 버튼으로만 연다.
// 폰·태블릿에서 세그먼트·듣기 바(.wd-chrome)와 하단 독은 내리면 접히고 올리면 앱바 아래로 돌아온다(use-reading-chrome).
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import type { HighlightItem, WordChunk } from "@truewords/api-client-ts/types";
import { ArrowDown, BookOpenText, NotebookPen } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import {
  CardMarkOverlay,
  CardPulloutBar,
  useMarkedParagraphs,
  useWordsCard,
} from "@/features/hoondok/cards/components/words-card";
import { sectionsKey, wordsKey } from "@/features/hoondok/query-keys";
import { useHoondokScreenTitle } from "@/features/hoondok/screen-title";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { libraryAPI, verseNumber, type WordsQuery, wordsHref, wordsPageHref } from "../api";
import { readHintDismissed, readLastColor, writeHintDismissed, writeLastColor } from "../highlight-prefs";
import {
  anchorHighlights,
  type Decoration,
  findWholeChunkHighlight,
  type HighlightColor,
  highlightInput,
  inputFromItem,
  MAX_QUOTE,
  partsToRanges,
  segmentChunk,
  splitParagraphs,
  type Segment as TextPiece,
  type TextRange,
  toHighlightColor,
  wholeChunkRange,
} from "../highlight-range";
import { writeLastReading } from "../last-reading";
import { hasSearchHit, markSearchTerms } from "../search-highlight";
import { TtsBar } from "../tts/tts-bar";
import { useReadAloud } from "../tts/use-read-aloud";
import { type AiVoiceId, chunkAudioUrl } from "../tts/voice-api";
import { isPendingHighlight, useHighlights, useHighlightWriter, useSavedReadingPosition } from "../use-reading";
import { useReadingChrome } from "../use-reading-chrome";
import { AiExplain } from "./ai-explain";
import { type HighlightActions, HighlightLayer } from "./highlight-layer";
import { HighlightNotes } from "./highlight-notes";
import { HighlightGateSheet, MemoSheet } from "./memo-sheet";
import { PassageSheet } from "./passage-sheet";
import { ReaderDock } from "./reader-dock";
import { ReaderSheet } from "./reader-sheet";
import { ReaderToast, useReaderToast } from "./reader-toast";
import { READER_TOOLS, type ReaderAction } from "./reader-tools";
import { ReadingEnd } from "./reading-end";
import { tocLabel, WordsToc } from "./words-toc";

const SEGMENTS = [
  { id: "text", label: "본문" },
  { id: "ai", label: "AI 설명" },
  { id: "note", label: "노트" },
] as const;
type Segment = (typeof SEGMENTS)[number]["id"];

type Sheet = "passage" | "toc" | "memo" | "gate";
/** 메모 시트 대상 — 새로 고른 구절(저장할 때 이 색으로 칠한다) 또는 이미 칠한 형광펜 */
type MemoTarget = { range: TextRange; color: HighlightColor } | { id: string };

const HIGHLIGHT_HINT = "칠할 구절을 길게 눌러 고르세요. PC에서는 끌어서 고를 수 있어요.";
const SAVE_FAILED = "기록을 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.";
const TOO_LONG = "한 번에 4,000자까지 칠할 수 있어요. 조금 줄여서 골라 주세요.";
const NO_DECORATIONS: Decoration[] = [];

/** ≥1024px 본문 위 가로 툴바. 폰·태블릿은 하단 독(ReaderDock)이 같은 도구를 보인다. */
function ReaderBar({ onAction }: { onAction: (action: ReaderAction) => void }) {
  return (
    <div className="reader reader--top" aria-label="읽기 도구">
      {READER_TOOLS.map(({ action, label, Icon }) => (
        <button
          key={action}
          type="button"
          className={action === "toc" ? "reader__toc" : undefined}
          onClick={() => onAction(action)}
        >
          <Icon size={22} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

/** 조각 하나. 형광펜(바깥) → 책갈피 카드 밑줄 → 검색어 밑줄(안쪽) 순서로 감싼다. */
function PieceText({ piece }: { piece: TextPiece }) {
  let node: ReactNode = piece.text;
  if (piece.isSearchHit) node = <mark className="sq-hit">{node}</mark>;
  if (piece.isCardMark) node = <span className="wd-card-ul">{node}</span>;
  if (piece.highlight)
    node = (
      <mark className={`hl hl-${piece.highlight.color}`} data-hl-id={piece.highlight.id}>
        {node}
      </mark>
    );
  return node;
}

/** 단락 하나. 형광펜은 고른 구절만 감싼다(API-HD-053) — 구간 계산은 ../highlight-range 가 맡는다.
 *  표시는 서버가 정리한 display_text(문단 "\n\n")이고, AI 설명·인용은 원본 text 를 쓴다.
 *  문단 span 의 글자는 display_text 조각 그대로여야 한다 — 선택 → 오프셋 계산이 data-start 와 글자 수로 위치를 잡는다. */
function Verse({
  chunk,
  decorations,
  isSelected,
  isSpeaking,
  onSelect,
  cardText,
  cardRibbonRef,
  isArrival,
  searchQuery,
}: {
  chunk: WordChunk;
  /** 이 단락에 걸친 형광펜 구간 */
  decorations: Decoration[];
  isSelected: boolean;
  isSpeaking: boolean;
  onSelect: () => void;
  /** 오늘의 책갈피가 꽂힌 단락이면 카드 본문 (PLAN-HD-012) — 그 문장에 밑줄·여백 리본 */
  cardText?: string | null;
  cardRibbonRef?: RefObject<HTMLSpanElement | null>;
  /** 검색·나의 기록·이어 읽기로 들어온 단락 — 도착 순간에만 은은하게 번졌다 사라진다 */
  isArrival?: boolean;
  /** 검색으로 들어온 단락이면 검색어. 밑줄은 저장하지 않는 임시 표시다(형광펜 = 배경색과 구분) */
  searchQuery?: string;
}) {
  const number = verseNumber(chunk.chunk_index);
  const text = chunk.display_text;
  const marked = useMarkedParagraphs(text, cardText);
  const pieces = useMemo(() => {
    // 책갈피 카드 밑줄이 있는 단락에는 검색어 밑줄을 긋지 않는다(원래 규칙 그대로)
    const extra: Decoration[] = marked
      ? marked.paragraphs.flatMap((paragraph) =>
          partsToRanges(paragraph.key, paragraph.parts, (part) => part.isMarked).map((range) => ({
            kind: "card" as const,
            ...range,
          })),
        )
      : searchQuery
        ? splitParagraphs(text).flatMap((paragraph) =>
            partsToRanges(paragraph.start, markSearchTerms(paragraph.text, searchQuery), (part) => part.hit).map(
              (range) => ({ kind: "search" as const, ...range }),
            ),
          )
        : [];
    return segmentChunk(text, extra.length ? [...decorations, ...extra] : decorations);
  }, [text, decorations, marked, searchQuery]);
  const verseRef = useRef<HTMLParagraphElement>(null);
  const className = [
    "verse",
    isSelected && "verse--on",
    isSpeaking && "verse--speaking",
    marked && "verse--card",
    marked && !marked.isMatched && "verse--card-all",
    isArrival && "verse--arrive",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <p
      className={className}
      id={`verse-${chunk.chunk_index}`}
      data-chunk-index={chunk.chunk_index}
      data-chunk-id={chunk.chunk_id}
      ref={verseRef}
    >
      {marked && cardRibbonRef && (
        <CardMarkOverlay verseRef={verseRef} isMatched={marked.isMatched} ribbonRef={cardRibbonRef} />
      )}
      {/* 본문 전체를 버튼으로 만들면 긴 인용문이 링크 이름이 된다(DES §2.2) — 번호만 조작 대상이다 */}
      <button type="button" className="verse__n" aria-label={`단락 ${number} 표시하기`} onClick={onSelect}>
        {number}
      </button>
      <span className="verse__tx">
        {pieces.map(({ paragraph, segments }) => (
          <span key={paragraph.start} className="verse__para" data-start={paragraph.start}>
            {segments.map((piece) => (
              <Fragment key={piece.start}>
                <PieceText piece={piece} />
                {piece.memoAfter.map((id) => (
                  // 메모 표지는 글자가 아니다 — 선택·오프셋 계산에서 빠지도록 data-hl-ui 로 표시한다
                  <button
                    key={id}
                    type="button"
                    className="hl-memo"
                    data-hl-ui=""
                    data-hl-memo={id}
                    aria-label="메모 보기"
                  >
                    <NotebookPen size={14} aria-hidden="true" />
                  </button>
                ))}
              </Fragment>
            ))}
          </span>
        ))}
      </span>
    </p>
  );
}

export function WordsScreen({
  volume,
  page,
  chunkId,
  section,
  cardId,
  searchQuery,
  isResume,
}: {
  volume: string;
  page: number;
  chunkId?: string;
  section?: number;
  /** 홈 이어 읽기 카드로 들어왔을 때(URL from=resume). 표시용이라 원문 API 로 보내지 않는다 */
  isResume?: boolean;
  /** 검색 결과로 들어왔을 때의 검색어(URL q). 원문 API 로 보내지 않고 화면 표시에만 쓴다 */
  searchQuery?: string;
  /** 오늘의 책갈피에서 "책에 다시 꽂기" 로 왔을 때의 카드 id (PLAN-HD-012). chunk_id 단락 안 문장에 밑줄을 긋는다 */
  cardId?: string;
}) {
  const [segment, setSegment] = useState<Segment>("text");
  const wordsCard = useWordsCard(cardId, chunkId);
  const cardRibbonRef = useRef<HTMLSpanElement>(null);
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [memoTarget, setMemoTarget] = useState<MemoTarget | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // 첫 사용 안내를 닫았는가(이 기기). 원문은 브라우저에서만 불러오므로 서버 렌더에는 이 안내가 없다.
  const [isHintDismissed, setIsHintDismissed] = useState(readHintDismissed);
  const [showSearchMarks, setShowSearchMarks] = useState(true);
  const citedNoticeRef = useRef<HTMLParagraphElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const chromeAnchorRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const { user } = useCurrentUser();
  const isLoggedIn = Boolean(user);

  const wordsQuery: WordsQuery = { chunkId, section };
  const query = useQuery({
    queryKey: wordsKey(volume, page, wordsQuery),
    queryFn: ({ signal }) => libraryAPI.words(volume, page, wordsQuery, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const sections = useQuery({
    queryKey: sectionsKey(volume),
    queryFn: ({ signal }) => libraryAPI.sections(volume, signal),
    retry: false,
    staleTime: 0,
  });
  useHoondokScreenTitle(query.isSuccess ? query.data.work_title : null);

  const highlights = useHighlights(volume, isLoggedIn);
  const toast = useReaderToast();
  const showToast = toast.show;
  const highlightWriter = useHighlightWriter(volume, () => showToast(SAVE_FAILED));
  const doc = query.isSuccess ? query.data : null;
  useReadingChrome(rootRef, chromeAnchorRef, chromeRef, doc !== null);
  const firstChunkIndex = doc?.chunks[0]?.chunk_index ?? null;
  // 이어 읽기: 로그인은 서버(API-HD-025), 비로그인은 기기에 남긴다. 같은 값 반복 PUT 은 훅이 막는다.
  useSavedReadingPosition(isLoggedIn, volume, firstChunkIndex);
  const lastVolume = doc?.volume ?? null;
  const lastPage = doc?.page ?? null;
  useEffect(() => {
    if (lastVolume && lastPage) writeLastReading({ volume: lastVolume, page: lastPage });
  }, [lastVolume, lastPage]);

  // 목차·검색 결과·나의 기록으로 들어오면 목표 단락이 페이지 중간일 수 있다 — 그 단락까지 한 번 내려 준다.
  // 목차는 장 시작 단락, 검색·나의 기록은 chunk_id 가 가리키는 단락이다.
  const tocStart = sections.data?.sections.find((item) => item.position === section)?.start_chunk_index ?? null;
  const citedIndex = chunkId ? (doc?.chunks.find((chunk) => chunk.chunk_id === chunkId)?.chunk_index ?? null) : null;
  const scrollTarget = tocStart ?? citedIndex;
  // 이어 읽기는 구간 첫 단락이 도착 단락이다(저장값이 그 단락). 라벨이 화면 밖일 때만 라벨 자리로 내린다 —
  // 이미 보이는데 내리면 위의 장 머리글이 앱바 뒤로 가려진다.
  const resumeIndex = isResume ? firstChunkIndex : null;
  useEffect(() => {
    if (resumeIndex === null) return;
    const label = document.getElementById("wd-resume");
    if (!label) return;
    const { top, bottom } = label.getBoundingClientRect();
    if (top >= 0 && bottom <= window.innerHeight) return;
    label.scrollIntoView?.({ block: "start" });
  }, [resumeIndex]);
  useEffect(() => {
    if (scrollTarget === null || lastPage === null) return;
    const target = document.getElementById(`verse-${scrollTarget}`);
    // 검색어가 긴 단락 뒤쪽에 있으면 단락 머리 대신 첫 검색어를 화면 가운데로 보낸다.
    const hit = target?.querySelector(".sq-hit");
    // jsdom 에는 scrollIntoView 가 없다 — 없으면 아무 일도 하지 않는다.
    if (hit) hit.scrollIntoView?.({ block: "center" });
    else target?.scrollIntoView?.({ block: "start" });
  }, [scrollTarget, lastPage]);

  // 듣기: 단락(청크)마다 표시 텍스트를 읽는다. 구간이 바뀌면 멈추고 처음 상태로 돌아간다.
  const docChunks = doc?.chunks;
  // 형광펜을 이 페이지 단락별 구간으로 — 다른 페이지 단락에 걸친 부분은 그리지 않는다
  const decorationsByChunk = useMemo(
    () => anchorHighlights(highlights.items, docChunks ?? []),
    [highlights.items, docChunks],
  );
  const speechParagraphs = useMemo(
    () => (docChunks ?? []).map((chunk) => ({ id: chunk.chunk_id, text: chunk.display_text })),
    [docChunks],
  );
  // AI 목소리는 청크 id 만 보낸다 — 서버가 같은 display_text 를 조회해 합성한다(임의 텍스트 합성 금지).
  const audioUrl = useCallback(
    (index: number, voice: AiVoiceId) => chunkAudioUrl(speechParagraphs[index]?.id ?? "", voice),
    [speechParagraphs],
  );
  const reader = useReadAloud(speechParagraphs, `${volume}|${lastPage ?? ""}`, audioUrl);
  const isReading = reader.status === "playing" || reader.status === "paused";
  const speakingIndex = isReading ? (docChunks?.[reader.currentIndex]?.chunk_index ?? null) : null;
  useEffect(() => {
    if (speakingIndex === null) return;
    // 읽는 단락을 화면 가운데로 따라간다. jsdom 에는 scrollIntoView 가 없다.
    document.getElementById(`verse-${speakingIndex}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [speakingIndex]);

  if (query.isPending)
    return (
      <section className="col col--read">
        <div className="wd-loading" role="status" aria-busy="true">
          {/* 문구는 스크린리더용, 화면에는 머리글·단락 자리만 보인다(PLAN-HD-008 트랙 C) */}
          <span className="wd-sr">원문을 불러오고 있어요</span>
          <span className="wd-skel wd-skel--head" aria-hidden="true" />
          <span className="wd-skel wd-skel--meta" aria-hidden="true" />
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className="wd-skel wd-skel--verse" aria-hidden="true" />
          ))}
        </div>
      </section>
    );
  if (query.isError || !doc) {
    const isMissing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <section className="col col--read">
        <div className="empty" role="status">
          <span className="empty__ic">
            <BookOpenText size={26} />
          </span>
          <p className="empty__title">{isMissing ? "이 원문을 열 수 없어요" : "원문을 불러오지 못했어요"}</p>
          <p className="empty__body">
            {isMissing
              ? "원문 공개가 허용되지 않았거나 해당 구간을 찾을 수 없어요."
              : "연결을 확인하고 다시 시도해 주세요."}
          </p>
          {!isMissing && (
            <button className="btn btn-line" type="button" onClick={() => void query.refetch()}>
              다시 시도
            </button>
          )}
          <Link className="btn btn-line" href="/hoondok/library">
            서고로 돌아가기
          </Link>
        </div>
      </section>
    );
  }

  const tocSections = sections.data?.sections ?? [];
  const currentSection = doc.section ?? null;
  const sectionDetail = currentSection
    ? (tocSections.find((item) => item.position === currentSection.position) ?? null)
    : null;
  const selectedChunk = doc.chunks.find((chunk) => chunk.chunk_id === selectedChunkId) ?? null;
  const currentPath = `${wordsHref(volume)}?page=${doc.page}`;
  const workTitle = doc.work_title;
  // 검색으로 들어온 경우에만 밑줄 안내를 보인다. 책갈피 카드로 들어온 단락은 카드 밑줄이 우선이다.
  const searchMarksOn = Boolean(searchQuery) && !cardId && showSearchMarks;
  const citedChunk = chunkId ? doc.chunks.find((chunk) => chunk.chunk_id === chunkId) : undefined;
  const citedHasHit = Boolean(searchQuery && citedChunk && hasSearchHit(citedChunk.display_text, searchQuery));

  // 새 형광펜은 로그인 계정에만 남는다. 첫 사용 안내는 이 권에 형광펜이 하나도 없을 때만 보인다.
  // 이어 읽기 도착에서는 띄우지 않는다 — 형광펜 조회가 원문보다 늦게 끝나면 안내가 라벨 위에 끼어들어
  // 도착한 단락이 한 번 밀려 내려간다. 안내는 다음에 원문을 그냥 열 때 보인다.
  const isFirstHintShown =
    !isHintDismissed &&
    resumeIndex === null &&
    (isLoggedIn ? highlights.isSuccess && highlights.items.length === 0 : true);
  const memoItem = memoTarget && "id" in memoTarget ? highlights.items.find((item) => item.id === memoTarget.id) : null;

  function openPassage(chunkKey: string) {
    setSelectedChunkId(chunkKey);
    setHint(null);
    setSheet("passage");
  }
  function closeSheet() {
    setSheet(null);
    setMemoTarget(null);
  }
  function handleReaderAction(action: ReaderAction) {
    if (action === "toc") {
      setSheet("toc");
      return;
    }
    if (action === "highlight") {
      setSegment("text");
      setHint(HIGHLIGHT_HINT);
      return;
    }
    setHint(null);
    setSegment("note");
  }

  /** 지우고 5초 동안 되돌릴 수 있다 — 되돌리기는 메모까지 같은 값으로 다시 만든다. */
  function eraseHighlight(item: HighlightItem) {
    highlightWriter.remove.mutate(item.id);
    showToast("형광펜을 지웠어요", {
      label: "되돌리기",
      run: () => highlightWriter.create.mutate(inputFromItem(item)),
    });
  }
  async function copyQuote(quote: string, chunkIndex: number) {
    const text = `${quote}\n\n${workTitle} · 단락 ${verseNumber(chunkIndex)}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast("복사했어요");
    } catch {
      showToast("복사하지 못했어요. 글자를 길게 눌러 직접 복사해 주세요.");
    }
  }
  /** 단락 시트 "단락 전체 칠하기": 없으면 칠하고, 다른 색이면 바꾸고, 지금 색을 다시 누르면 지운다. */
  function paintWholeChunk(chunk: WordChunk, color: HighlightColor) {
    const current = findWholeChunkHighlight(highlights.items, chunk);
    if (current && isPendingHighlight(current.id)) return;
    if (current && toHighlightColor(current.color) === color) {
      eraseHighlight(current);
      return;
    }
    writeLastColor(color);
    if (current) {
      highlightWriter.update.mutate({ id: current.id, patch: { color } });
      return;
    }
    const range = wholeChunkRange(chunk);
    if (!range) return;
    if (range.quote.length > MAX_QUOTE) {
      showToast("이 단락은 너무 길어 전체를 칠할 수 없어요. 본문에서 구절을 골라 칠해 주세요.");
      return;
    }
    highlightWriter.create.mutate(highlightInput(volume, range, color));
  }
  async function saveMemo(note: string): Promise<boolean> {
    if (!memoTarget) return false;
    try {
      if ("range" in memoTarget)
        await highlightWriter.create.mutateAsync(highlightInput(volume, memoTarget.range, memoTarget.color, note));
      else await highlightWriter.update.mutateAsync({ id: memoTarget.id, patch: { note: note || null } });
    } catch {
      // 실패 알림은 쓰기 훅이 띄운다 — 시트는 열어 두어 적은 글을 지킨다
      return false;
    }
    closeSheet();
    showToast(note ? "메모를 저장했어요" : "메모를 지웠어요");
    return true;
  }
  const highlightActions: HighlightActions = {
    onCreate: (range, color) => {
      if (!isLoggedIn) {
        setSheet("gate");
        return;
      }
      if (range.quote.length > MAX_QUOTE) {
        showToast(TOO_LONG);
        return;
      }
      writeLastColor(color);
      highlightWriter.create.mutate(highlightInput(volume, range, color));
    },
    onOpenMemo: (target) => {
      if (!isLoggedIn) {
        setSheet("gate");
        return;
      }
      if ("range" in target && target.range.quote.length > MAX_QUOTE) {
        showToast(TOO_LONG);
        return;
      }
      setMemoTarget("range" in target ? { range: target.range, color: readLastColor() } : target);
      setSheet("memo");
    },
    onCopy: (quote, chunkIndex) => void copyQuote(quote, chunkIndex),
    onRecolor: (item, color) => {
      writeLastColor(color);
      highlightWriter.update.mutate({ id: item.id, patch: { color } });
    },
    onErase: eraseHighlight,
  };
  // 모달 시트가 열려 있으면 바깥 알림은 누를 수 없다 — 열린 시트 안에 그린다
  const toastNode = toast.toast && <ReaderToast toast={toast.toast} onDismiss={toast.dismiss} />;

  return (
    <section className="col col--read words" ref={rootRef}>
      <aside className="toc" aria-label={tocLabel(tocSections)}>
        <WordsToc
          volume={volume}
          workTitle={doc.work_title}
          sections={tocSections}
          currentPosition={currentSection?.position ?? null}
          page={doc.page}
          totalPages={doc.total_pages}
        />
      </aside>
      <div className="words__main">
        {/* 저작물 제목은 앱바 h1 이 이미 보여준다(screens.ts titleSource: "work") */}
        <div className="masthead">
          {currentSection && <span className="masthead__nm">{currentSection.title}</span>}
          <span className="masthead__dt">
            {doc.page} / {doc.total_pages} 구간
          </span>
        </div>
        <div className="src lede-src">
          {/* 장 데이터가 날짜·장소를 가진 권만 실제 값을 보인다. 없는 값은 지어내지도, 결측 문구로 채우지도 않는다
              (PLAN-HD-008). 파일 이름(volume 키)은 사람에게 의미가 없어 보이지 않는다 */}
          {sectionDetail?.spoken_on && <span>{sectionDetail.spoken_on}</span>}
          {sectionDetail?.place && <span>{sectionDetail.place}</span>}
          {doc.authority_grade === "R" ? (
            <span className="badge badge--dashed">공식성 확인되지 않음</span>
          ) : (
            <AuthorityBadge grade={doc.authority_grade} />
          )}
        </div>
        <div className="lede-rule" />
        <ReaderBar onAction={handleReaderAction} />
        <div ref={chromeAnchorRef} />
        <div className="wd-chrome" ref={chromeRef}>
          <div className="pill-seg" role="tablist" aria-label="원문 보기">
            {SEGMENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`wd-seg-${item.id}`}
                aria-selected={segment === item.id}
                aria-controls="wd-seg-panel"
                className={segment === item.id ? "is-on" : ""}
                onClick={() => setSegment(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <TtsBar
            reader={reader}
            title={`듣기 · ${doc.page}구간`}
            total={doc.chunks.length}
            nextHref={doc.page < doc.total_pages ? wordsPageHref(volume, doc.page + 1) : null}
          />
          {/* 도구를 누른 순간에는 크롬이 보이는 상태다 — 안내를 크롬 안에 두어야 스크롤 위치와 무관하게 보인다 */}
          {hint && (
            <p className="notice" role="status">
              {hint}
            </p>
          )}
        </div>
        <div id="wd-seg-panel" className="wd-panel" role="tabpanel" aria-labelledby={`wd-seg-${segment}`}>
          {segment === "text" && (
            <>
              {tocSections.length === 0 && (
                <p className="notice">
                  이 권은 장 목차가 아직 없어 원문을 순서대로 보여드려요. 단락 번호는 책의 장·절 번호가 아닙니다.
                </p>
              )}
              {chunkId && (
                // 밑줄을 지우면 버튼이 사라진다 — 같은 안내 줄로 초점을 옮겨 키보드·스크린리더 위치를 지킨다
                <p
                  className={`notice${searchQuery && !wordsCard.card ? " notice--search" : ""}`}
                  role="status"
                  tabIndex={-1}
                  ref={citedNoticeRef}
                >
                  {wordsCard.card
                    ? "오늘의 책갈피가 꽂힌 자리예요."
                    : !searchMarksOn
                      ? "인용한 말씀이 포함된 원문 구간이에요."
                      : citedHasHit
                        ? "검색어에 밑줄을 그었어요. 저장되지 않는 표시예요."
                        : "검색어가 그대로 나오지는 않지만 뜻이 가까운 구간이에요."}
                  {searchMarksOn && citedHasHit && (
                    <button
                      className="notice__action"
                      type="button"
                      onClick={() => {
                        setShowSearchMarks(false);
                        citedNoticeRef.current?.focus();
                      }}
                    >
                      밑줄 지우기
                    </button>
                  )}
                </p>
              )}
              {isFirstHintShown && (
                <p className="notice wd-hl-hint">
                  글자를 길게 누르면 원하는 구절에 형광펜과 메모를 남길 수 있어요.
                  <button
                    className="notice__action"
                    type="button"
                    onClick={() => {
                      writeHintDismissed();
                      setIsHintDismissed(true);
                    }}
                  >
                    알겠어요
                  </button>
                </p>
              )}
              {resumeIndex !== null && (
                <p className="wd-resume" id="wd-resume" role="status">
                  <span className="wd-resume__lab">
                    <ArrowDown size={15} aria-hidden="true" />
                    여기서부터 이어 읽어요
                  </span>
                </p>
              )}
              <HighlightLayer chunks={doc.chunks} items={highlights.items} actions={highlightActions}>
                {doc.chunks.map((chunk) => {
                  const isCardChunk = wordsCard.card?.chunk_id === chunk.chunk_id;
                  return (
                    <Fragment key={chunk.chunk_id}>
                      <Verse
                        chunk={chunk}
                        decorations={decorationsByChunk.get(chunk.chunk_index) ?? NO_DECORATIONS}
                        isSelected={chunk.chunk_id === selectedChunkId}
                        isSpeaking={chunk.chunk_index === speakingIndex}
                        onSelect={() => openPassage(chunk.chunk_id)}
                        cardText={isCardChunk ? wordsCard.card?.text : null}
                        cardRibbonRef={cardRibbonRef}
                        isArrival={(!cardId && chunk.chunk_id === chunkId) || chunk.chunk_index === resumeIndex}
                        searchQuery={searchMarksOn && chunk.chunk_id === chunkId ? searchQuery : undefined}
                      />
                      {isCardChunk && wordsCard.card && (
                        <CardPulloutBar card={wordsCard.card} isToday={wordsCard.isToday} ribbonRef={cardRibbonRef} />
                      )}
                    </Fragment>
                  );
                })}
              </HighlightLayer>
              <ReadingEnd volume={volume} workTitle={workTitle} page={doc.page} totalPages={doc.total_pages} />
            </>
          )}
          {segment === "ai" && <AiExplain chunk={selectedChunk} />}
          {segment === "note" && (
            <HighlightNotes
              volume={volume}
              items={highlights.items}
              isLoggedIn={isLoggedIn}
              returnTo={currentPath}
              onOpen={() => setSegment("text")}
            />
          )}
        </div>
      </div>
      <ReaderDock reader={reader} total={doc.chunks.length} onAction={handleReaderAction} />
      {sheet === null && toastNode}
      {sheet === "toc" && (
        <ReaderSheet title={tocLabel(tocSections)} onClose={closeSheet} toast={toastNode}>
          <nav className="toc toc--sheet" aria-label={tocLabel(tocSections)}>
            <WordsToc
              volume={volume}
              workTitle={doc.work_title}
              sections={tocSections}
              currentPosition={currentSection?.position ?? null}
              page={doc.page}
              totalPages={doc.total_pages}
              onNavigate={() => setSheet(null)}
            />
          </nav>
        </ReaderSheet>
      )}
      {sheet === "passage" && selectedChunk && (
        <PassageSheet
          chunk={selectedChunk}
          wholeHighlight={findWholeChunkHighlight(highlights.items, selectedChunk)}
          isLoggedIn={isLoggedIn}
          returnTo={currentPath}
          toast={toastNode}
          onPaintWhole={(color) => paintWholeChunk(selectedChunk, color)}
          onClose={closeSheet}
          onListenFrom={
            reader.isSupported && !reader.isResolving
              ? () => {
                  // iOS 는 제스처 안에서 시작한 재생만 허용한다 — 누른 핸들러에서 바로 부른다.
                  reader.play(doc.chunks.indexOf(selectedChunk));
                  setSheet(null);
                }
              : undefined
          }
        />
      )}
      {sheet === "memo" && memoTarget && ("range" in memoTarget || memoItem) && (
        <MemoSheet
          key={"range" in memoTarget ? "new" : memoTarget.id}
          quote={"range" in memoTarget ? memoTarget.range.quote : (memoItem?.quote ?? "")}
          color={"range" in memoTarget ? memoTarget.color : toHighlightColor(memoItem?.color)}
          chunkIndex={"range" in memoTarget ? memoTarget.range.startChunkIndex : (memoItem?.start_chunk_index ?? 0)}
          initialNote={"range" in memoTarget ? "" : (memoItem?.note ?? "")}
          isNew={"range" in memoTarget}
          toast={toastNode}
          onSave={saveMemo}
          onClose={closeSheet}
        />
      )}
      {sheet === "gate" && <HighlightGateSheet returnTo={currentPath} toast={toastNode} onClose={closeSheet} />}
    </section>
  );
}
