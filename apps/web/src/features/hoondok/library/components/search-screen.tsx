"use client";

// SCR-PWA-008 말씀 검색 (PLAN-HD-002 W3-L). 검색 엔진은 권리 원장·코퍼스 재적재 뒤라 아직 없다 —
// 이 화면은 입력·분류·기록의 형태만 보이고 어떤 요청도 보내지 않는다. 결과는 fixture 부분 문자열 대조다.
// 입력 전 상태(최근 검색 · 이렇게도 찾을 수 있어요 · 질문 안내)는 프로토타입 data-screen="search" 그대로다.
import { ChevronRight, History, MessageCircleQuestion, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import { filterPreviewResults, PREVIEW_SEARCH_HOWTO } from "@/features/hoondok/preview/fixtures/library";
import {
  appendRecentSearch,
  clearRecentSearches,
  EMPTY_RECENT,
  readRecentSearches,
  subscribeRecentSearches,
} from "../recent-searches";

// 프로토타입 앱바 입력의 placeholder·aria-label 그대로.
const PLACEHOLDER = "단어, 구절, 상황을 입력해 주세요";
const LABEL = "말씀 검색";
const PENDING = "검색은 준비 중이에요";

export function SearchScreen() {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  /** 마지막으로 찾기를 누른 말. null 이면 아직 입력 전 상태다. */
  const [submitted, setSubmitted] = useState<string | null>(null);
  // 최근 검색의 원본은 이 기기의 localStorage 하나뿐이다. 서버 스냅샷이 빈 배열이라 SSR 과 첫 렌더가 같다.
  const recent = useSyncExternalStore(subscribeRecentSearches, readRecentSearches, () => EMPTY_RECENT as string[]);
  const text = query.trim();
  const results = submitted ? filterPreviewResults(submitted) : [];

  function runSearch(value: string) {
    const next = value.trim();
    if (!next) return;
    // 질의는 서버로 가지 않는다 — 기기에만 남기고 준비 중 상태를 보인다.
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
      <p className="notice">미리보기 예시 데이터입니다</p>

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
            <h2 className="sect__title">예시 결과</h2>
            <span className="sect__meta">{`${results.length}건`}</span>
          </div>
          {/* 왜 진짜 결과가 아닌지는 색이 아니라 글자가 말한다 (DES-PWA-003 §3.3) */}
          <p className="sf-status" role="status">
            {`${PENDING} — 아래는 예시 말씀에서 고른 결과예요`}
          </p>
          {results.length === 0 ? (
            <div className="empty">
              <span className="empty__ic">
                <SearchX size={26} aria-hidden="true" />
              </span>
              <p className="empty__title">예시 결과가 없어요</p>
              <p className="empty__body">지금은 예시 말씀 한 편에서만 찾을 수 있어요. 아래 칩으로 골라 보세요.</p>
            </div>
          ) : (
            <ul className="sr-list">
              {results.map((result) => (
                <li key={result.id}>
                  <Link href={`/hoondok/words/${result.wordId}`}>
                    <span className="sr-hd">
                      <b>{result.title}</b>
                      <AuthorityBadge grade={result.grade} />
                    </span>
                    <span className="sr-snippet">{result.snippet}</span>
                    <span className="sr-src">{result.source}</span>
                  </Link>
                </li>
              ))}
            </ul>
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
