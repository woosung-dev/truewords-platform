"use client";

// 단락 시트 (SCR-PWA-009 · PLAN-HD-007 §2-6). 단락 번호를 눌러 연다 — 이 단락부터 듣기 · 단락 전체 칠하기.
// 원하는 구절만 칠하고 메모를 다는 일은 본문 글자 선택이 맡는다(API-HD-053). 여기 "단락 전체 칠하기" 는
// 끌어서 고르기 어려운 사람을 위한 드래그 없는 경로다(WCAG 2.5.7, DES-PWA-003 §3.6).
// "이 단락으로 질문하기" 는 단락 인용을 채운 새 질문 화면을 연다(보내지는 않는다). 로그인과 무관하다.
// "이 단락부터 듣기" 는 듣기를 몰라도 되게 콜백만 받는다 — 소리를 낼 수 없으면 원문 뷰가 넘기지 않는다.
import type { HighlightItem, WordChunk } from "@truewords/api-client-ts/types";
import { Check, MessageCircleQuestion, Play } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { onboardingHref } from "@/features/identity/gate";
import { verseNumber } from "../api";
import { COLOR_NAME, HIGHLIGHT_COLORS, type HighlightColor, toHighlightColor } from "../highlight-range";
import { ReaderSheet } from "./reader-sheet";

/** 인용이 길면 URL·입력창이 넘치지 않게 앞부분만 담는다. */
const ASK_QUOTE_MAX = 200;

export function passageAskHref(displayText: string): string {
  const text = displayText.trim();
  const quote = text.length > ASK_QUOTE_MAX ? `${text.slice(0, ASK_QUOTE_MAX)}…` : text;
  return `/hoondok/ask/new?q=${encodeURIComponent(`"${quote}"\n\n이 단락은 어떤 뜻인가요?`)}`;
}

export function PassageSheet({
  chunk,
  wholeHighlight,
  isLoggedIn,
  returnTo,
  toast,
  onPaintWhole,
  onClose,
  onListenFrom,
}: {
  chunk: WordChunk;
  /** 이 단락 전체를 칠한 형광펜. 부분 구절 형광펜은 여기 들어오지 않는다 */
  wholeHighlight: HighlightItem | undefined;
  isLoggedIn: boolean;
  returnTo: string;
  toast?: ReactNode;
  /** 색을 누르면 칠하기·색 바꾸기, 지금 색을 다시 누르면 지우기(되돌리기 알림)는 원문 뷰가 정한다 */
  onPaintWhole: (color: HighlightColor) => void;
  onClose: () => void;
  /** 이 단락부터 소리 내어 읽고 시트를 닫는다. 없으면 버튼을 그리지 않는다. */
  onListenFrom?: () => void;
}) {
  const title = `단락 ${verseNumber(chunk.chunk_index)}`;
  // 듣기는 로그인과 무관하다 — 로그인 안내 시트에도 같은 버튼을 둔다.
  const listenButton = onListenFrom && (
    <button className="btn btn-line btn--sm rd-sheet__listen" type="button" onClick={onListenFrom}>
      <Play size={18} aria-hidden="true" />이 단락부터 듣기
    </button>
  );

  // 비로그인 시트에는 로그인 버튼이 주 버튼이라 질문 링크는 테두리 버튼으로 물러난다
  const askLink = (
    <Link
      className={`btn ${isLoggedIn ? "btn-primary" : "btn-line"} rd-sheet__ask`}
      href={passageAskHref(chunk.display_text)}
    >
      <MessageCircleQuestion size={18} aria-hidden="true" />이 단락으로 질문하기
    </Link>
  );

  if (!isLoggedIn) {
    return (
      <ReaderSheet title={title} onClose={onClose} toast={toast}>
        <p className="js-lede">형광펜·메모는 계정에 남는 기록이에요.</p>
        {listenButton}
        {askLink}
        <p className="rd-sheet__gate">로그인하면 기록이 남아요</p>
        <Link className="btn btn-primary" href={onboardingHref(returnTo)}>
          로그인하고 표시하기
        </Link>
      </ReaderSheet>
    );
  }

  const activeColor = wholeHighlight ? toHighlightColor(wholeHighlight.color) : null;

  return (
    <ReaderSheet title={title} onClose={onClose} toast={toast}>
      <p className="js-lede rd-sheet__quote">{chunk.display_text}</p>
      {listenButton}
      {askLink}
      <div className="rd-sheet__row">
        <span className="rd-sheet__lab" id="rd-hl-label">
          단락 전체 칠하기
        </span>
        <div className="rd-hl" role="group" aria-labelledby="rd-hl-label">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`rd-hl__sw rd-hl__sw--${color}`}
              aria-pressed={activeColor === color}
              aria-label={`${COLOR_NAME[color]} 형광펜`}
              onClick={() => onPaintWhole(color)}
            >
              {activeColor === color && <Check size={16} strokeWidth={2.5} aria-hidden="true" />}
              {activeColor === color ? "선택됨" : ""}
            </button>
          ))}
        </div>
      </div>
      <p className="notice rd-sheet__hint">
        원하는 구절만 칠하려면 본문 글자를 길게 누르세요. PC에서는 끌어서 고르면 돼요.
      </p>
    </ReaderSheet>
  );
}
