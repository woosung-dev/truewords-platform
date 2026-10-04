"use client";

import { useQuery } from "@tanstack/react-query";
import type { WordSearchResponse } from "@truewords/api-client-ts/types";
import { ChevronRight, History, MessageCircleQuestion, Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import { PREVIEW_SEARCH_HOWTO } from "@/features/hoondok/preview/fixtures/library";
import { libraryAPI, wordsHref } from "../api";
import { sharedGrade } from "../grade";
import {
  appendRecentSearch,
  clearRecentSearches,
  EMPTY_RECENT,
  readLastSearch,
  readRecentSearches,
  subscribeRecentSearches,
  writeLastSearch,
} from "../recent-searches";
import { hasSearchHit, highlightSnippet } from "../search-highlight";

// 프로토타입 앱바 입력의 placeholder·aria-label 그대로.
const PLACEHOLDER = "단어, 구절, 상황을 입력해 주세요";
const LABEL = "말씀 검색";

type SearchResult = WordSearchResponse["results"][number];

/**
 * 결과 머리 아래 한 줄. 검색 결과의 화자·판본은 API 가 주지 않으므로 행마다 쓰지 않고 여기서 한 번만 적는다.
 * 결과 전체가 R 이면 등급 설명도 같은 줄에 묶는다(DES §2.3 "검색 결과 상단 한 줄 안내").
 */
function resultsNote(listGrade: SearchResult["authority_grade"] | null): string {
  return listGrade === "R" ? "모두 공식성·화자·판본이 확인되지 않은 참고 자료예요." : "화자·판본은 확인되지 않았어요.";
}

/** 검색 결과 한 묶음. 뜻이 가까운 묶음은 검색어가 본문에 없으니 밑줄 없이 앞부분이 그대로 보인다. */
function ResultGroup({
  id,
  title,
  description,
  results,
  query,
  listGrade,
}: {
  id: string;
  title: string;
  description?: string;
  results: SearchResult[];
  query: string;
  /** 결과 전체가 같은 등급이면 그 등급 — 머리에 한 번 보였으므로 행에서는 뺀다 */
  listGrade: SearchResult["authority_grade"] | null;
}) {
  return (
    <section className="sr-group" aria-labelledby={id}>
      <div className="sect__head">
        <h3 className="sect__title" id={id}>
          {title}
        </h3>
        <span className="sect__meta">{results.length}건</span>
      </div>
      {description && <p className="sr-group__desc">{description}</p>}
      <ul className="sr-list">
        {results.map((result) => {
          const body = (
            <>
              <span className="sr-hd">
                <b>{result.work_title}</b>
                {result.authority_grade !== listGrade && <AuthorityBadge grade={result.authority_grade} />}
              </span>
              <span className="sr-snippet">
                {highlightSnippet(result.display_text, query).map((part, index) =>
                  part.hit ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 조각 순서가 곧 본문 순서다
                    <mark key={index} className="sq-hit">
                      {part.text}
                    </mark>
                  ) : (
                    part.text
                  ),
                )}
              </span>
            </>
          );
          return (
            <li key={result.chunk_id}>
              {result.can_read_full_text ? (
                <Link href={wordsHref(result.volume, result.chunk_id, query)}>{body}</Link>
              ) : (
                <div className="sr-unavailable">
                  {body}
                  <p className="notice">검색 인용만 허용된 저작물이에요. 원문 공개 권리는 확인 중입니다.</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SearchScreen() {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // 결과를 열었다 뒤로 오면 마지막 검색어로 다시 시작한다(이 탭 sessionStorage). 서버 스냅샷이 null 이라
  // SSR·hydration 첫 렌더는 빈 입력이고, 바로 다음 렌더에서 되살린 값이 들어온다.
  const restored = useSyncExternalStore(subscribeRecentSearches, readLastSearch, () => null);
  /** 입력칸에 손댄 값. null 이면 아직 손대지 않아 되살린 검색어를 보인다. */
  const [typed, setTyped] = useState<string | null>(null);
  /** 마지막으로 찾기를 누른 말. undefined 면 되살린 검색어, null 이면 아직 입력 전 상태다. */
  const [submittedState, setSubmitted] = useState<string | null | undefined>(undefined);
  const query = typed ?? restored ?? "";
  const submitted = submittedState === undefined ? restored : submittedState;
  // 최근 검색의 원본은 이 기기의 localStorage 하나뿐이다. 서버 스냅샷이 빈 배열이라 SSR 과 첫 렌더가 같다.
  const recent = useSyncExternalStore(subscribeRecentSearches, readRecentSearches, () => EMPTY_RECENT as string[]);
  const text = query.trim();
  // 캐시는 기본 보관 시간(5분)을 쓴다 — 뒤로 오자마자 결과가 보여야 스크롤 위치도 돌아온다.
  // 키가 ["hoondok", …] 이라 로그인·로그아웃 때 다른 훈독 캐시와 함께 지워진다.
  const search = useQuery({
    queryKey: ["hoondok", "word-search", submitted],
    queryFn: ({ signal }) => libraryAPI.search(submitted ?? "", signal),
    enabled: Boolean(submitted),
    retry: false,
  });
  const results = search.isError ? [] : (search.data?.results ?? []);
  // 서버는 의미·단어 검색을 섞어 점수순으로 준다. 목록 밑줄과 같은 규칙으로 나누고 각 묶음 안은 서버 순서를 지킨다.
  const wordHits = submitted ? results.filter((result) => hasSearchHit(result.display_text, submitted)) : [];
  const meaningHits = submitted ? results.filter((result) => !hasSearchHit(result.display_text, submitted)) : [];
  const listGrade = sharedGrade(results.map((result) => result.authority_grade));

  function runSearch(value: string) {
    const next = value.trim();
    if (!next) return;
    // 최근 검색·마지막 검색어는 이 기기에만 보관한다. 검색어는 검색 API 외에 오류 보고로 보내지 않는다.
    appendRecentSearch(next);
    writeLastSearch(next);
    setTyped(next);
    setSubmitted(next);
  }

  function fillQuery(value: string) {
    setTyped(value);
    inputRef.current?.focus();
  }

  function clearRecent() {
    // 되살린 검색어는 최근 검색에 기대고 있다 — 지우기 전에 지금 보이는 입력·결과를 화면 상태로 붙잡아 둔다
    setTyped(query);
    setSubmitted(submitted);
    clearRecentSearches();
  }

  return (
    <section className="col">
      <form
        className="sf-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch(query);
        }}
      >
        <label className="field__label" htmlFor={inputId}>
          {LABEL}
        </label>
        <div className="sf-field">
          <Search size={20} aria-hidden="true" />
          <input
            ref={inputRef}
            id={inputId}
            className="sf-input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={200}
            placeholder={PLACEHOLDER}
            value={query}
            onChange={(event) => setTyped(event.target.value)}
          />
          {/* 브라우저 기본 지우기(×)는 색을 바꿀 수 없어 숨기고 같은 일을 하는 버튼을 둔다 */}
          {query && (
            <button
              className="sf-clear"
              type="button"
              aria-label="검색어 지우기"
              onClick={() => {
                setTyped("");
                inputRef.current?.focus();
              }}
            >
              <X size={20} aria-hidden="true" />
            </button>
          )}
          <button className="btn btn-line sf-submit" type="submit" disabled={!text}>
            찾기
          </button>
        </div>
      </form>

      {submitted !== null && (
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">검색 결과</h2>
            {results.length > 0 && listGrade && <AuthorityBadge grade={listGrade} />}
          </div>
          {search.isPending ? (
            <p className="sf-status" role="status" aria-busy="true">
              말씀을 찾고 있어요
            </p>
          ) : search.isError ? (
            <div className="empty" role="status">
              <span className="empty__ic">
                <SearchX size={26} aria-hidden="true" />
              </span>
              <p className="empty__title">검색하지 못했어요</p>
              <p className="empty__body">입력한 검색어는 그대로 있어요. 잠시 뒤 다시 시도해 주세요.</p>
              <button className="btn btn-line" type="button" onClick={() => void search.refetch()}>
                다시 시도
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className="empty" role="status">
              <span className="empty__ic">
                <SearchX size={26} aria-hidden="true" />
              </span>
              <p className="empty__title">검색 결과가 없어요</p>
              <p className="empty__body">검색이 허용된 말씀에서 찾지 못했어요. 다른 단어나 짧은 구절로 찾아보세요.</p>
              <Link className="btn btn-line" href="/hoondok/library">
                서고로 돌아가기
              </Link>
            </div>
          ) : (
            <>
              <p className="list-note">{resultsNote(listGrade)}</p>
              {wordHits.length > 0 && (
                <ResultGroup
                  id={`${inputId}-word`}
                  title="검색어가 나온 말씀"
                  results={wordHits}
                  query={submitted}
                  listGrade={listGrade}
                />
              )}
              {meaningHits.length > 0 && (
                <ResultGroup
                  id={`${inputId}-meaning`}
                  title="뜻이 가까운 말씀"
                  description="검색어가 그대로 나오지는 않지만 뜻이 가까워요."
                  results={meaningHits}
                  query={submitted}
                  listGrade={listGrade}
                />
              )}
            </>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">최근 검색</h2>
            <button className="sect__meta" type="button" onClick={clearRecent}>
              지우기
            </button>
          </div>
          <ul className="recent">
            {recent.map((item) => (
              <li key={item}>
                <button type="button" onClick={() => runSearch(item)}>
                  <History size={20} aria-hidden="true" />
                  {item}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">이렇게도 찾을 수 있어요</h2>
        </div>
        <div className="howto">
          {PREVIEW_SEARCH_HOWTO.map((row) => (
            <div key={row.key} className="howto__row">
              <span className="howto__k">{row.key}</span>
              <div className="chips">
                {row.chips.map((chip) => (
                  <button key={chip} className="term" type="button" onClick={() => fillQuery(chip)}>
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sect">
        <Link className="ask-hint" href="/hoondok/ask">
          <MessageCircleQuestion size={24} aria-hidden="true" />
          <span>
            <b>궁금한 것이 질문이라면</b>
            <span>“왜 정성을 드려야 하나요” 같은 질문은 AI 질문에서 근거 말씀과 함께 답해요</span>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
