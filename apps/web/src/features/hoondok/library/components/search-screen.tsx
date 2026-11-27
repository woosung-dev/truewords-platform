"use client";

import { Search } from "lucide-react";
import { useId, useRef, useState } from "react";
import { SEARCH_LABEL, SEARCH_MAX_LENGTH, SEARCH_PLACEHOLDER, submitSearch, WordSearchBody } from "./word-search";

/** /search 전체 화면. initialQuery(주소의 q)가 있으면 열자마자 그 말로 찾는다(최근 검색에는 넣지 않는다). */
export function SearchScreen({ initialQuery }: { initialQuery?: string }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [submitted, setSubmitted] = useState<string | null>(initialQuery || null);
  const text = query.trim();

  function runSearch(value: string) {
    const next = submitSearch(value);
    if (!next) return;
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
          {SEARCH_LABEL}
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
            maxLength={SEARCH_MAX_LENGTH}
            placeholder={SEARCH_PLACEHOLDER}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="btn btn-line sf-submit" type="submit" disabled={!text}>
            찾기
          </button>
        </div>
      </form>

      <WordSearchBody idPrefix={inputId} submitted={submitted} onRun={runSearch} onFill={fillQuery} />
    </section>
  );
}
