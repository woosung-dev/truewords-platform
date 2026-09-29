"use client";

// 구절 메모 시트 (API-HD-053). 메모는 형광펜에 붙는다 — 새 구절이면 저장할 때 형광펜을 함께 만들고,
// 이미 칠한 구절이면 메모만 고친다(비워서 저장하면 메모만 지워지고 형광펜은 남는다).
// 저장이 끝날 때까지 시트를 닫지 않는다 — 실패해도 적은 글이 남아 있어야 한다(DES-PWA-003 §1.5 error).
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import { onboardingHref } from "@/features/identity/gate";
import { verseNumber } from "../api";
import { COLOR_NAME, type HighlightColor, MAX_NOTE } from "../highlight-range";
import { ReaderSheet } from "./reader-sheet";

/** 이 글자 수부터 남은 양을 보인다 */
const COUNT_FROM = MAX_NOTE - 200;

export function MemoSheet({
  quote,
  color,
  chunkIndex,
  initialNote,
  isNew,
  toast,
  onSave,
  onClose,
}: {
  quote: string;
  color: HighlightColor;
  chunkIndex: number;
  initialNote: string;
  /** 아직 칠하지 않은 구절 — 빈 메모로는 저장하지 않는다 */
  isNew: boolean;
  toast?: ReactNode;
  /** 저장 성공이면 true. 원문 뷰가 성공하면 시트를 닫는다. */
  onSave: (note: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [note, setNote] = useState(initialNote);
  const [isSaving, setIsSaving] = useState(false);
  const fieldId = useId();
  const value = note.trim();
  const isClearing = !isNew && initialNote !== "" && value === "";

  async function save() {
    setIsSaving(true);
    const isSaved = await onSave(value);
    if (!isSaved) setIsSaving(false);
  }

  return (
    <ReaderSheet title="메모" onClose={onClose} toast={toast}>
      <figure className={`rd-memo__quote rd-memo__quote--${color}`}>
        <blockquote>{quote}</blockquote>
        <figcaption>
          {COLOR_NAME[color]} 형광펜 · 단락 {verseNumber(chunkIndex)}
        </figcaption>
      </figure>
      <label className="rd-memo__field" htmlFor={fieldId}>
        <span className="rd-sheet__lab">메모</span>
        <textarea
          id={fieldId}
          value={note}
          maxLength={MAX_NOTE}
          onChange={(event) => setNote(event.target.value)}
          placeholder="이 구절을 읽으며 든 생각을 적어 보세요"
        />
      </label>
      <p className="rd-memo__foot">
        <span>나만 봄 · 계정에 저장돼요</span>
        {note.length >= COUNT_FROM && (
          <span className="rd-memo__count">
            {note.length.toLocaleString("ko-KR")} / {MAX_NOTE.toLocaleString("ko-KR")}
          </span>
        )}
      </p>
      {isClearing && <p className="notice">비워서 저장하면 메모만 지워지고 형광펜은 남아요.</p>}
      <button
        className="btn btn-primary rd-memo__save"
        type="button"
        onClick={() => void save()}
        disabled={isSaving || (isNew && value === "")}
        aria-busy={isSaving || undefined}
      >
        저장
      </button>
    </ReaderSheet>
  );
}

/** 비로그인에게 형광펜·메모를 누르면 보이는 안내 (단락 시트의 로그인 안내와 같은 문구). */
export function HighlightGateSheet({
  returnTo,
  toast,
  onClose,
}: {
  returnTo: string;
  toast?: ReactNode;
  onClose: () => void;
}) {
  return (
    <ReaderSheet title="형광펜·메모" onClose={onClose} toast={toast}>
      <p className="js-lede">형광펜·메모·북마크는 계정에 남는 기록이에요. 복사는 로그인 없이 할 수 있어요.</p>
      <p className="rd-sheet__gate">로그인하면 기록이 남아요</p>
      <Link className="btn btn-primary" href={onboardingHref(returnTo)}>
        로그인하고 표시하기
      </Link>
    </ReaderSheet>
  );
}
