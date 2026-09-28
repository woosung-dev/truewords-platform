"use client";

// 단락 시트 (SCR-PWA-009 · PLAN-HD-007 §2-6). 형광펜 3색 · 북마크 · 노트를 한 단락(=청크)에 건다.
// 노트는 별도 테이블이 아니라 형광펜의 `note` 라서(ENT-HD-012), 형광펜이 없는 단락에 노트를 남기면
// 1번 색 형광펜을 함께 만든다 — 시트 안에 그 사실을 적어 둔다.
// "이 단락부터 듣기" 는 듣기를 몰라도 되게 콜백만 받는다 — 소리를 낼 수 없으면 원문 뷰가 넘기지 않는다.
import type { MarkItem, WordChunk } from "@truewords/api-client-ts/types";
import { Bookmark, BookmarkCheck, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { onboardingHref } from "@/features/identity/gate";
import { verseNumber } from "../api";
import type { useMarkWriter } from "../use-reading";
import { ReaderSheet } from "./reader-sheet";

export const HIGHLIGHT_COLORS = [1, 2, 3] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
/** 색 이름. 색만으로 구분하지 않도록 버튼·나의 기록 칩이 함께 쓴다 (디자인 시스템 §1 형광펜 3색) */
export const HIGHLIGHT_COLOR_LABEL: Record<HighlightColor, string> = { 1: "노랑", 2: "초록", 3: "분홍" };
/** 노트만 남길 때 함께 만드는 형광펜 색 */
const NOTE_DEFAULT_COLOR: HighlightColor = 1;

export function PassageSheet({
  volume,
  chunk,
  highlight,
  bookmark,
  isLoggedIn,
  returnTo,
  writer,
  onClose,
  onListenFrom,
}: {
  volume: string;
  chunk: WordChunk;
  highlight: MarkItem | undefined;
  bookmark: MarkItem | undefined;
  isLoggedIn: boolean;
  returnTo: string;
  writer: ReturnType<typeof useMarkWriter>;
  onClose: () => void;
  /** 이 단락부터 소리 내어 읽고 시트를 닫는다. 없으면 버튼을 그리지 않는다. */
  onListenFrom?: () => void;
}) {
  const [note, setNote] = useState(highlight?.note ?? "");
  const title = `단락 ${verseNumber(chunk.chunk_index)}`;
  // 듣기는 로그인과 무관하다 — 로그인 안내 시트에도 같은 버튼을 둔다.
  const listenButton = onListenFrom && (
    <button className="btn btn-line btn--sm rd-sheet__listen" type="button" onClick={onListenFrom}>
      <Play size={18} aria-hidden="true" />이 단락부터 듣기
    </button>
  );

  if (!isLoggedIn) {
    return (
      <ReaderSheet title={title} onClose={onClose}>
        <p className="js-lede">형광펜·노트·북마크는 계정에 남는 기록이에요.</p>
        {listenButton}
        <p className="rd-sheet__gate">로그인하면 기록이 남아요</p>
        <Link className="btn btn-primary" href={onboardingHref(returnTo)}>
          로그인하고 표시하기
        </Link>
      </ReaderSheet>
    );
  }

  const activeColor = highlight?.color;
  function toggleColor(color: HighlightColor) {
    if (activeColor === color) {
      writer.remove.mutate({ chunkId: chunk.chunk_id, kind: "highlight" });
      return;
    }
    writer.save.mutate({
      chunkId: chunk.chunk_id,
      input: {
        volume,
        chunk_index: chunk.chunk_index,
        kind: "highlight",
        color,
        note: highlight?.note ?? null,
      },
    });
  }
  function toggleBookmark() {
    if (bookmark) {
      writer.remove.mutate({ chunkId: chunk.chunk_id, kind: "bookmark" });
      return;
    }
    writer.save.mutate({
      chunkId: chunk.chunk_id,
      input: { volume, chunk_index: chunk.chunk_index, kind: "bookmark", color: null, note: null },
    });
  }
  function saveNote() {
    const value = note.trim();
    writer.save.mutate({
      chunkId: chunk.chunk_id,
      input: {
        volume,
        chunk_index: chunk.chunk_index,
        kind: "highlight",
        color: activeColor ?? NOTE_DEFAULT_COLOR,
        note: value === "" ? null : value,
      },
    });
  }

  return (
    <ReaderSheet title={title} onClose={onClose}>
      <p className="js-lede rd-sheet__quote">{chunk.display_text}</p>
      {listenButton}
      <div className="rd-sheet__row">
        <span className="rd-sheet__lab" id="rd-hl-label">
          형광펜
        </span>
        <div className="rd-hl" role="group" aria-labelledby="rd-hl-label">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`rd-hl__sw rd-hl__sw--${color}`}
              aria-pressed={activeColor === color}
              aria-label={`${HIGHLIGHT_COLOR_LABEL[color]} 형광펜`}
              onClick={() => toggleColor(color)}
            >
              {activeColor === color ? "선택됨" : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="rd-sheet__row">
        <span className="rd-sheet__lab">북마크</span>
        <button
          type="button"
          className="btn btn-line btn--sm"
          aria-pressed={Boolean(bookmark)}
          onClick={toggleBookmark}
        >
          {bookmark ? <BookmarkCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
          {bookmark ? "북마크 해제" : "북마크"}
        </button>
      </div>
      <label className="rd-sheet__note" htmlFor="rd-note">
        <span className="rd-sheet__lab">노트</span>
        <textarea
          id="rd-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="이 단락에 남길 메모"
        />
      </label>
      <p className="notice">
        {activeColor
          ? "노트는 이 단락의 형광펜에 함께 저장돼요."
          : "노트를 저장하면 이 단락에 노랑 형광펜도 함께 생겨요."}
      </p>
      <button className="btn btn-primary" type="button" onClick={saveNote} disabled={writer.isSaving}>
        노트 저장
      </button>
      {writer.hasFailed && <p className="notice">기록을 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.</p>}
    </ReaderSheet>
  );
}
