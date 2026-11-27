"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import Link from "next/link";
import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { SEARCH_LABEL, SEARCH_MAX_LENGTH, SEARCH_PLACEHOLDER, submitSearch, WordSearchBody } from "./word-search";

export type HeaderSearchVariant = "pc" | "mobile";

/**
 * 머리글 제자리 검색(B안). PC 는 헤더 검색 자리가 입력으로 펼쳐지고 아래로 패널이 열린다.
 * 모바일은 앱바 자리를 입력 줄(← · 입력 · ✕)로 바꾸고 화면 전체를 결과 층으로 덮는다.
 * 찾기(Enter)를 눌러야 찾는다 — 타자마다 찾지 않는다. 열고 닫기·기록 처리는 앱 셸이 맡는다.
 */
export function HeaderSearch({
  id,
  variant,
  onClose,
  onLeave,
}: {
  id: string;
  variant: HeaderSearchVariant;
  /** ESC·← · 빈 칸의 ✕ 로 닫는다. 셸이 여는 버튼으로 초점을 돌려준다. */
  onClose: () => void;
  /** 패널 안 링크를 눌러 다른 화면으로 떠난다. 초점을 돌려주지 않는다. */
  onLeave: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const isMobile = variant === "mobile";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  function clearOrClose() {
    if (!query) {
      onClose();
      return;
    }
    setQuery("");
    setSubmitted(null);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
  }

  // 결과·안내 링크를 누르면 이동하면서 닫는다(같은 주소로 가는 링크도 닫힌다).
  function onLinkClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("a[href]")) onLeave();
  }

  const clearButton = (
    <button
      className="hs__clear"
      type="button"
      aria-label={query ? "검색어 지우기" : "검색 닫기"}
      onClick={clearOrClose}
    >
      <XIcon size={20} aria-hidden="true" />
    </button>
  );

  return (
    <div
      id={id}
      className={`hs hs--${variant}`}
      role="dialog"
      aria-modal="true"
      aria-label={SEARCH_LABEL}
      onKeyDown={onKeyDown}
      onClick={onLinkClick}
    >
      <form
        className="hs__bar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch(query);
        }}
      >
        {isMobile && (
          <button className="icon-btn" type="button" aria-label="검색 닫기" onClick={onClose}>
            <ArrowLeftIcon size={22} aria-hidden="true" />
          </button>
        )}
        <div className="hs__field">
          <MagnifyingGlassIcon size={20} aria-hidden="true" />
          <input
            ref={inputRef}
            id={inputId}
            className="hs__input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={SEARCH_MAX_LENGTH}
            placeholder={SEARCH_PLACEHOLDER}
            aria-label={SEARCH_LABEL}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {/* PC 는 빈 칸에서도 ✕ 로 닫는다. 모바일은 ← 가 닫기라 글자가 있을 때만 지우기로 보인다 */}
          {(!isMobile || query) && clearButton}
        </div>
      </form>
      <div className="hs__panel">
        <div className="hs__body">
          <WordSearchBody
            idPrefix={inputId}
            submitted={submitted}
            onRun={runSearch}
            onFill={fillQuery}
            replaceLinks={isMobile}
          />
        </div>
        {!isMobile && (
          <div className="hs__foot">
            <span>Enter 찾기 · Esc 닫기</span>
            {submitted && (
              <Link href={`/search?q=${encodeURIComponent(submitted)}`} prefetch={false}>
                결과 페이지로 크게 보기 ›
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
