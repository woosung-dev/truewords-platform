// 나의 기록 한 줄. 형광펜은 고른 구절(`quote`), 북마크는 원문 표시 글(display_text) 발췌를 그대로 두고
// 줄 수만 CSS 로 줄인다 — 글자를 바꾸지 않는다.
// 글이 null 이면 원문이 막혔거나 확인하지 못한 권이라 원문 링크를 숨긴다(권리 게이트는 서버가 판정).
import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { verseNumber, wordsHref } from "../../library/api";
import { COLOR_NAME } from "../../library/highlight-range";
import { hasNote, type RecordEntry, recordDateLabel, volumeTitle } from "../records";

export const BLOCKED_TEXT = "원문 공개 확인 중";

/** 보일 글. 형광펜은 원문 뷰처럼 그 색으로 칠한다. */
export function RecordQuote({ entry, className = "rc-q" }: { entry: RecordEntry; className?: string }) {
  if (entry.text == null) return <p className={`${className} rc-q--blocked`}>{BLOCKED_TEXT}</p>;
  return (
    <p className={className}>{entry.color ? <mark className={`hl-${entry.color}`}>{entry.text}</mark> : entry.text}</p>
  );
}

export function RecordItem({ entry, showVolume }: { entry: RecordEntry; showVolume: boolean }) {
  const where = `${showVolume ? `${volumeTitle(entry)} · ` : ""}단락 ${verseNumber(entry.chunk_index)}`;
  const body = (
    <>
      <RecordQuote entry={entry} className="rc-q rc-q--4" />
      {hasNote(entry) && (
        <p className="rc-note">
          <NotebookPen size={17} aria-label="노트" />
          <span>{entry.note}</span>
        </p>
      )}
      <span className="rc-meta">
        {entry.color && (
          <span>
            <span className={`rc-sw rc-sw--${entry.color} rc-sw--sm`} aria-hidden="true" />
            {COLOR_NAME[entry.color]}
          </span>
        )}
        <span>{where}</span>
        <span>{recordDateLabel(entry.updated_at)}</span>
      </span>
    </>
  );
  return (
    <li className="rc-item">
      {entry.text == null ? (
        <div className="rc-item__main">{body}</div>
      ) : (
        <Link className="rc-item__main" href={wordsHref(entry.volume, entry.chunk_id)}>
          {body}
        </Link>
      )}
    </li>
  );
}
