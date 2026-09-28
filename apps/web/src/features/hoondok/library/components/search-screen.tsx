"use client";

import { useQuery } from "@tanstack/react-query";
import type { WordSearchResponse } from "@truewords/api-client-ts/types";
import { ChevronRight, History, MessageCircleQuestion, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import { PREVIEW_SEARCH_HOWTO } from "@/features/hoondok/preview/fixtures/library";
import { libraryAPI, wordsHref } from "../api";
import {
  appendRecentSearch,
  clearRecentSearches,
  EMPTY_RECENT,
  readRecentSearches,
  subscribeRecentSearches,
} from "../recent-searches";
import { hasSearchHit, highlightSnippet } from "../search-highlight";

// 프로토타입 앱바 입력의 placeholder·aria-label 그대로.
const PLACEHOLDER = "단어, 구절, 상황을 입력해 주세요";
const LABEL = "말씀 검색";

type SearchResult = WordSearchResponse["results"][number];

/** 검색 결과 한 묶음. 뜻이 가까운 묶음은 검색어가 본문에 없으니 밑줄 없이 앞부분이 그대로 보인다. */
function ResultGroup({
  id,
  title,
  description,
  results,
  query,
}: {
  id: string;
  title: string;
  description?: string;
  results: SearchResult[];
  query: string;
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
                {result.authority_grade === "R" ? (
                  <span className="badge badge--dashed">공식성 확인되지 않음</span>
                ) : (
                  <AuthorityBadge grade={result.authority_grade} />
                )}
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
              <span className="sr-src">화자·판본 확인되지 않음</span>
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
  const [query, setQuery] = useState("");
  /** 마지막으로 찾기를 누른 말. null 이면 아직 입력 전 상태다. */
  const [submitted, setSubmitted] = useState<string | null>(null);
  // 최근 검색의 원본은 이 기기의 localStorage 하나뿐이다. 서버 스냅샷이 빈 배열이라 SSR 과 첫 렌더가 같다.
  const recent = useSyncExternalStore(subscribeRecentSearches, readRecentSearches, () => EMPTY_RECENT as string[]);
  const text = query.trim();
  const search = useQuery({
    queryKey: ["hoondok", "word-search", submitted],
    queryFn: ({ signal }) => libraryAPI.search(submitted ?? "", signal),
    enabled: Boolean(submitted),
    retry: false,
    gcTime: 0,
  });
  const results = search.isError ? [] : (search.data?.results ?? []);
  // 서버는 의미·단어 검색을 섞어 점수순으로 준다. 목록 밑줄과 같은 규칙으로 나누고 각 묶음 안은 서버 순서를 지킨다.
  const wordHits = submitted ? results.filter((result) => hasSearchHit(result.display_text, submitted)) : [];
  const meaningHits = submitted ? results.filter((result) => !hasSearchHit(result.display_text, submitted)) : [];

  function runSearch(value: string) {
    const next = value.trim();
    if (!next) return;
    // 최근 검색은 이 기기에만 보관한다. 검색어는 검색 API 외에 오류 보고로 보내지 않는다.
    appendRecentSearch(next);
    setQuery(next);
    setSubmitted(next);
  }

  function fillQuery(value: string) {
    setQuery(value);
    inputRef.current?.focus();
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
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="btn btn-line sf-submit" type="submit" disabled={!text}>
            찾기
          </button>
        </div>
      </form>

      {submitted !== null && (
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">검색 결과</h2>
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
              {wordHits.length > 0 && (
                <ResultGroup id={`${inputId}-word`} title="검색어가 나온 말씀" results={wordHits} query={submitted} />
              )}
              {meaningHits.length > 0 && (
                <ResultGroup
                  id={`${inputId}-meaning`}
                  title="뜻이 가까운 말씀"
                  description="검색어가 그대로 나오지는 않지만 뜻이 가까워요."
                  results={meaningHits}
                  query={submitted}
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
            <button className="sect__meta" type="button" onClick={clearRecentSearches}>
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
            <span>{'"왜 정성을 드려야 하나요" 같은 질문은 AI 질문에서 근거 말씀과 함께 답해요'}</span>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
