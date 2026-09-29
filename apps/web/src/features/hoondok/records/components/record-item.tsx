// 나의 기록 한 줄. 발췌는 원문 표시 글(display_text) 그대로이고 줄 수만 CSS 로 줄인다 — 글자를 바꾸지 않는다.
// 발췌가 null 이면 원문이 막혔거나 확인하지 못한 단락이라 원문 링크를 숨긴다(권리 게이트는 서버가 판정).
import type { MarkItem } from "@truewords/api-client-ts/types";
import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { verseNumber, wordsHref } from "../../library/api";
import { COLOR_NAME, type HighlightColor } from "../../library/highlight-range";
import { hasNote, recordDateLabel, volumeTitle } from "../records";

export const BLOCKED_TEXT = "원문 공개 확인 중";

function colorOf(mark: MarkItem): HighlightColor | null {
  return mark.kind === "highlight" && (mark.color === 1 || mark.color === 2 || mark.color === 3) ? mark.color : null;
}

/** 발췌 글. 형광펜은 원문 뷰처럼 그 색으로 칠한다. */
export function RecordQuote({ mark, className = "rc-q" }: { mark: MarkItem; className?: string }) {
  if (mark.excerpt == null) return <p className={`${className} rc-q--blocked`}>{BLOCKED_TEXT}</p>;
  const color = colorOf(mark);
  return <p className={className}>{color ? <mark className={`hl-${color}`}>{mark.excerpt}</mark> : mark.excerpt}</p>;
}

export function RecordItem({ mark, showVolume }: { mark: MarkItem; showVolume: boolean }) {
  const color = colorOf(mark);
  const where = `${showVolume ? `${volumeTitle(mark)} · ` : ""}단락 ${verseNumber(mark.chunk_index)}`;
  const body = (
    <>
      <RecordQuote mark={mark} className="rc-q rc-q--4" />
      {hasNote(mark) && (
        <p className="rc-note">
          <NotebookPen size={17} aria-label="노트" />
          <span>{mark.note}</span>
        </p>
      )}
      <span className="rc-meta">
        {color && (
          <span>
            <span className={`rc-sw rc-sw--${color} rc-sw--sm`} aria-hidden="true" />
            {COLOR_NAME[color]}
          </span>
        )}
        <span>{where}</span>
        <span>{recordDateLabel(mark.updated_at)}</span>
      </span>
    </>
  );
  return (
    <li className="rc-item">
      {mark.excerpt == null ? (
        <div className="rc-item__main">{body}</div>
      ) : (
        <Link className="rc-item__main" href={wordsHref(mark.volume, mark.chunk_id)}>
          {body}
        </Link>
      )}
    </li>
  );
}
