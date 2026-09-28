"use client";

// SCR-PWA-009 원문 뷰. PLAN-HD-007 로 장 목차(API-HD-024)·단락 표시(API-HD-026)·이어 읽기(API-HD-025)·
// AI 설명(§2-7)이 붙었다. 단락 단위는 Qdrant 청크이고(§2-12) 청크 안 부분 선택은 하지 않는다.
// PLAN-HD-008 로 표시 텍스트(display_text)·본문 탭 선택·브라우저 음성 듣기(../tts)가 더해졌다.
// PLAN-HD-011 로 듣기는 AI 목소리(단락 mp3)가 기본이고 브라우저 음성은 대체 경로다.
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import type { MarkItem, WordChunk } from "@truewords/api-client-ts/types";
import { ArrowDown, Bookmark, BookOpenText, Check, Highlighter, List, NotebookPen, Settings } from "lucide-react";
import Link from "next/link";
import { Fragment, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthorityBadge, HoondokButton } from "@/components/hoondok";
import {
  CardMarkOverlay,
  CardPulloutBar,
  useMarkedParagraphs,
  useWordsCard,
} from "@/features/hoondok/cards/components/words-card";
import { sectionsKey, wordsKey } from "@/features/hoondok/query-keys";
import { useHoondokScreenTitle } from "@/features/hoondok/screen-title";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { libraryAPI, verseNumber, type WordsQuery, wordsHref, wordsPageHref } from "../api";
import { writeLastReading } from "../last-reading";
import { hasSearchHit, markSearchTerms } from "../search-highlight";
import { TtsBar } from "../tts/tts-bar";
import { useReadAloud } from "../tts/use-read-aloud";
import { type AiVoiceId, chunkAudioUrl } from "../tts/voice-api";
import { useMarks, useMarkWriter, useSavedReadingPosition } from "../use-reading";
import { AiExplain } from "./ai-explain";
import { PassageSheet } from "./passage-sheet";
import { ReaderSheet } from "./reader-sheet";
import { tocLabel, WordsToc } from "./words-toc";

const SEGMENTS = [
  { id: "text", label: "본문" },
  { id: "ai", label: "AI 설명" },
  { id: "note", label: "노트" },
] as const;
type Segment = (typeof SEGMENTS)[number]["id"];

type ReaderAction = "highlight" | "note" | "bookmark" | "toc";
const READER_TOOLS = [
  { action: "highlight" as const, label: "형광펜", Icon: Highlighter },
  { action: "note" as const, label: "노트", Icon: NotebookPen },
  { action: "bookmark" as const, label: "북마크", Icon: Bookmark },
  { action: "toc" as const, label: "목차", Icon: List },
] as const;

function ReaderBar({
  modifier,
  onAction,
}: {
  modifier: "reader--top" | "reader--bottom";
  onAction: (action: ReaderAction) => void;
}) {
  return (
    <div className={`reader ${modifier}`} aria-label="읽기 도구">
      {READER_TOOLS.map(({ action, label, Icon }) => (
        <button
          key={label}
          type="button"
          className={action === "toc" ? "reader__toc" : undefined}
          onClick={() => onAction(action)}
        >
          <Icon size={22} aria-hidden="true" />
          {label}
        </button>
      ))}
      {/* 설정(글자 크기·테마)은 이번 범위가 아니다 — 누를 수 없는 상태를 그대로 보인다 */}
      <button type="button" disabled aria-disabled="true">
        <Settings size={22} aria-hidden="true" />
        설정
      </button>
    </div>
  );
}

function StudyComplete() {
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  const completion = useMissionCompletion("study", user, isLoading);
  const isDone = completion.isDone || Boolean(summary?.today.study);
  return (
    <div className="sect">
      {isDone ? (
        <div className="card read-done" role="status">
          <p>오늘 말씀 읽기를 마쳤어요.</p>
          {completion.isUnsynced && (
            <Link href={onboardingHref("/hoondok/library")}>로그인하면 오늘 기록이 남아요 →</Link>
          )}
          {completion.hasSaveFailed && <p>기록을 아직 저장하지 못했어요. 연결되면 다시 시도해요.</p>}
        </div>
      ) : (
        <HoondokButton onClick={completion.markDone} isLoading={completion.isSaving} disabled={isLoading}>
          <Check size={20} />
          읽음
        </HoondokButton>
      )}
      <p className="notice">말씀 읽기 완료를 기록해요. 연속 훈독일은 훈독하기 완료를 기준으로 계산해요.</p>
      <Link className="btn btn-line" href="/hoondok">
        오늘 훈독으로 돌아가기
      </Link>
    </div>
  );
}

/** 단락 하나. 형광펜은 청크 전체를 감싼다 — 부분 선택은 검색·인용 체계(chunk_id)와 어긋난다(계획 §8).
 *  표시는 서버가 정리한 display_text(문단 "\n\n")이고, AI 설명·인용은 원본 text 를 쓴다. */
function Verse({
  chunk,
  highlight,
  isBookmarked,
  isSelected,
  isSpeaking,
  onSelect,
  cardText,
  cardRibbonRef,
  isArrival,
  searchQuery,
}: {
  chunk: WordChunk;
  highlight: MarkItem | undefined;
  isBookmarked: boolean;
  isSelected: boolean;
  isSpeaking: boolean;
  onSelect: () => void;
  /** 오늘의 책갈피가 꽂힌 단락이면 카드 본문 (PLAN-HD-012) — 그 문장에 밑줄·여백 리본 */
  cardText?: string | null;
  cardRibbonRef?: RefObject<HTMLSpanElement | null>;
  /** 검색·북마크·이어 읽기로 들어온 단락 — 도착 순간에만 은은하게 번졌다 사라진다 */
  isArrival?: boolean;
  /** 검색으로 들어온 단락이면 검색어. 밑줄은 저장하지 않는 임시 표시다(형광펜 = 배경색과 구분) */
  searchQuery?: string;
}) {
  const number = verseNumber(chunk.chunk_index);
  const paragraphs = chunk.display_text.split("\n\n").filter(Boolean);
  const marked = useMarkedParagraphs(chunk.display_text, cardText);
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
  // 본문 아무 데나 탭하면 시트가 열린다. 드래그로 글자를 고르는 중이면 열지 않는다(복사 방해 금지).
  function handleBodyClick() {
    if (window.getSelection()?.toString()) return;
    onSelect();
  }
  return (
    // 키보드·스크린리더는 번호 버튼으로 연다 — 단락 클릭은 포인터 보조 경로다.
    // biome-ignore lint/a11y/useKeyWithClickEvents: 같은 동작의 버튼(.verse__n)이 단락 안에 있다
    <p className={className} id={`verse-${chunk.chunk_index}`} onClick={handleBodyClick} ref={verseRef}>
      {marked && cardRibbonRef && (
        <CardMarkOverlay verseRef={verseRef} isMatched={marked.isMatched} ribbonRef={cardRibbonRef} />
      )}
      {/* 본문 전체를 버튼으로 만들면 긴 인용문이 링크 이름이 된다(DES §2.2) — 번호만 조작 대상이다 */}
      <button
        type="button"
        className="verse__n"
        aria-label={`단락 ${number} 표시하기`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        {number}
        {isBookmarked && <Bookmark size={12} aria-hidden="true" />}
      </button>
      <span className="verse__tx">
        {marked?.paragraphs.map((paragraph) => {
          const parts = paragraph.parts.map((part, index) =>
            part.isMarked ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 조각 순서가 곧 정체성이다
              <span key={index} className="wd-card-ul">
                {part.text}
              </span>
            ) : (
              part.text
            ),
          );
          return (
            <span key={paragraph.key} className="verse__para">
              {highlight?.color ? <mark className={`hl-${highlight.color}`}>{parts}</mark> : parts}
            </span>
          );
        })}
        {!marked &&
          paragraphs.map((paragraph, index) => {
            const text = searchQuery
              ? markSearchTerms(paragraph, searchQuery).map((part, partIndex) =>
                  part.hit ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 조각 순서가 곧 본문 순서다
                    <mark key={partIndex} className="sq-hit">
                      {part.text}
                    </mark>
                  ) : (
                    part.text
                  ),
                )
              : paragraph;
            return (
              // 문단은 순서가 곧 정체성이다(서버 정리 결과가 바뀌면 청크 key 가 다시 그린다).
              // biome-ignore lint/suspicious/noArrayIndexKey: 문단 목록은 재정렬되지 않는다
              <span key={index} className="verse__para">
                {highlight?.color ? <mark className={`hl-${highlight.color}`}>{text}</mark> : text}
              </span>
            );
          })}
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
  const [sheet, setSheet] = useState<"passage" | "toc" | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [showSearchMarks, setShowSearchMarks] = useState(true);
  const citedNoticeRef = useRef<HTMLParagraphElement>(null);
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

  const marks = useMarks(volume, isLoggedIn);
  const writer = useMarkWriter();
  const doc = query.isSuccess ? query.data : null;
  const firstChunkIndex = doc?.chunks[0]?.chunk_index ?? null;
  // 이어 읽기: 로그인은 서버(API-HD-025), 비로그인은 기기에 남긴다. 같은 값 반복 PUT 은 훅이 막는다.
  useSavedReadingPosition(isLoggedIn, volume, firstChunkIndex);
  const lastVolume = doc?.volume ?? null;
  const lastPage = doc?.page ?? null;
  useEffect(() => {
    if (lastVolume && lastPage) writeLastReading({ volume: lastVolume, page: lastPage });
  }, [lastVolume, lastPage]);

  // 목차·검색 결과·북마크로 들어오면 목표 단락이 페이지 중간일 수 있다 — 그 단락까지 한 번 내려 준다.
  // 목차는 장 시작 단락, 검색·북마크는 chunk_id 가 가리키는 단락이다.
  const tocStart = sections.data?.sections.find((item) => item.position === section)?.start_chunk_index ?? null;
  const citedIndex = chunkId ? (doc?.chunks.find((chunk) => chunk.chunk_id === chunkId)?.chunk_index ?? null) : null;
  const scrollTarget = tocStart ?? citedIndex;
  // 이어 읽기는 구간 첫 단락이 도착 단락이다(저장값이 그 단락). 라벨이 보이도록 라벨 자리로 내린다.
  const resumeIndex = isResume ? firstChunkIndex : null;
  useEffect(() => {
    if (resumeIndex === null) return;
    document.getElementById("wd-resume")?.scrollIntoView?.({ block: "start" });
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
  const markOf = (chunk: string, kind: MarkItem["kind"]) =>
    marks.find((mark) => mark.chunk_id === chunk && mark.kind === kind);
  const noteMarks = marks.filter((mark) => mark.kind === "highlight" && mark.note);
  const currentPath = `${wordsHref(volume)}?page=${doc.page}`;
  // 검색으로 들어온 경우에만 밑줄 안내를 보인다. 책갈피 카드로 들어온 단락은 카드 밑줄이 우선이다.
  const searchMarksOn = Boolean(searchQuery) && !cardId && showSearchMarks;
  const citedChunk = chunkId ? doc.chunks.find((chunk) => chunk.chunk_id === chunkId) : undefined;
  const citedHasHit = Boolean(searchQuery && citedChunk && hasSearchHit(citedChunk.display_text, searchQuery));

  function openPassage(chunkKey: string) {
    setSelectedChunkId(chunkKey);
    setHint(null);
    setSheet("passage");
  }
  function handleReaderAction(action: ReaderAction) {
    if (action === "toc") {
      setSheet("toc");
      return;
    }
    if (!selectedChunkId) {
      setHint("먼저 본문에서 단락을 눌러 골라 주세요.");
      return;
    }
    setHint(null);
    setSheet("passage");
  }

  return (
    <section className="col col--read words">
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
        <ReaderBar modifier="reader--top" onAction={handleReaderAction} />
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
        {hint && (
          <p className="notice" role="status">
            {hint}
          </p>
        )}
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
              {resumeIndex !== null && (
                <p className="wd-resume" id="wd-resume" role="status">
                  <span className="wd-resume__lab">
                    <ArrowDown size={15} aria-hidden="true" />
                    여기서부터 이어 읽어요
                  </span>
                </p>
              )}
              <article aria-label="원문 본문">
                {doc.chunks.map((chunk) => {
                  const isCardChunk = wordsCard.card?.chunk_id === chunk.chunk_id;
                  return (
                    <Fragment key={chunk.chunk_id}>
                      <Verse
                        chunk={chunk}
                        highlight={markOf(chunk.chunk_id, "highlight")}
                        isBookmarked={Boolean(markOf(chunk.chunk_id, "bookmark"))}
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
              </article>
              <nav className="words-pages" aria-label="원문 구간 이동">
                {doc.page > 1 && (
                  <Link className="btn btn-line btn--sm" href={wordsPageHref(volume, doc.page - 1)}>
                    이전 구간
                  </Link>
                )}
                {/* 현재 구간 번호는 머리글(.masthead__dt)이 보인다 — 여기서는 이동만 한다 */}
                {doc.page < doc.total_pages && (
                  <Link className="btn btn-line btn--sm" href={wordsPageHref(volume, doc.page + 1)}>
                    다음 구간
                  </Link>
                )}
              </nav>
              <StudyComplete />
            </>
          )}
          {segment === "ai" && <AiExplain chunk={selectedChunk} />}
          {segment === "note" && (
            <>
              {!isLoggedIn ? (
                <div className="empty">
                  <span className="empty__ic">
                    <NotebookPen size={26} aria-hidden="true" />
                  </span>
                  <p className="empty__title">로그인하면 기록이 남아요</p>
                  <p className="empty__body">노트는 계정에 저장돼요. 로그인하면 이 권의 메모를 모아서 볼 수 있어요.</p>
                  <Link className="btn btn-line btn--sm" href={onboardingHref(currentPath)}>
                    로그인하기
                  </Link>
                </div>
              ) : noteMarks.length === 0 ? (
                <div className="empty">
                  <span className="empty__ic">
                    <NotebookPen size={26} aria-hidden="true" />
                  </span>
                  <p className="empty__title">이 권에 남긴 노트가 아직 없어요</p>
                  <p className="empty__body">본문에서 단락을 누르면 형광펜과 함께 메모를 남길 수 있어요.</p>
                </div>
              ) : (
                <ul className="rd-notes">
                  {noteMarks.map((mark) => (
                    <li key={mark.chunk_id}>
                      <Link href={wordsHref(volume, mark.chunk_id)}>
                        <span className="rd-notes__n">단락 {verseNumber(mark.chunk_index)}</span>
                        <span className="rd-notes__tx">{mark.note}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <Link className="btn btn-line btn--sm" href="/hoondok/ask">
          이 말씀에 질문하기
        </Link>
      </div>
      <ReaderBar modifier="reader--bottom" onAction={handleReaderAction} />
      {sheet === "toc" && (
        <ReaderSheet title={tocLabel(tocSections)} onClose={() => setSheet(null)}>
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
          volume={volume}
          chunk={selectedChunk}
          highlight={markOf(selectedChunk.chunk_id, "highlight")}
          bookmark={markOf(selectedChunk.chunk_id, "bookmark")}
          isLoggedIn={isLoggedIn}
          returnTo={currentPath}
          writer={writer}
          onClose={() => setSheet(null)}
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
    </section>
  );
}
