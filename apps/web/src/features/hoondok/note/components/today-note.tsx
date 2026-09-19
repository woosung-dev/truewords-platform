"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { NOTE_MAX, readNote, subscribeNote, writeNote } from "../storage";

// 입력이 멈춘 뒤 저장까지 기다리는 시간과, "저장됨" 을 띄워 두는 시간.
const SAVE_DEBOUNCE_MS = 300;
const SAVED_VISIBLE_MS = 1500;

// 프로토타입 app.html `data-screen="read"` 의 .my-note 문구.
const PLACEHOLDER = "오늘 이 말씀을 어디에서 실천해 볼까요? (선택)";

/**
 * SCR-PWA-003 "오늘의 한 줄" — 말씀 아래 기기 전용 메모 (PLAN-HD-002 W1-N).
 * 서버로 보내지 않으므로 계정이 없어도 쓸 수 있고, 다른 기기에서는 보이지 않는다.
 */
export function TodayNote({ readingDate }: { readingDate: string }) {
  // 저장된 값의 원본은 localStorage 다. 서버 스냅샷이 빈 문자열이라 SSR 과 첫 렌더가 같고,
  // hydration 이 끝난 뒤 저장된 값으로 바뀐다 (use-install-card·use-missions 와 같은 패턴).
  const stored = useSyncExternalStore(
    subscribeNote,
    () => readNote(readingDate),
    () => "",
  );
  // 입력 중인 값. null 이면 아직 손대지 않아 저장된 값을 그대로 보여준다.
  const [draft, setDraft] = useState<string | null>(null);
  // 0 이면 숨김. 저장할 때마다 올라가므로 연속 저장에도 표시 시간이 새로 시작된다.
  const [savedTick, setSavedTick] = useState(0);
  const text = draft ?? stored;

  // 입력이 300ms 멈춘 뒤 한 번만 저장한다 — 타자 중에는 타이머가 계속 새로 걸린다.
  useEffect(() => {
    if (draft === null) return;
    const timer = window.setTimeout(() => {
      writeNote(readingDate, draft);
      setSavedTick((tick) => tick + 1);
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, readingDate]);

  useEffect(() => {
    if (savedTick === 0) return;
    const timer = window.setTimeout(() => setSavedTick(0), SAVED_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [savedTick]);

  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title" id="today-note-label">
          오늘의 한 줄
        </h2>
        <span className="sect__meta">나만 봄 · 이 기기에만 저장돼요</span>
      </div>
      <textarea
        className="my-note"
        aria-labelledby="today-note-label"
        rows={3}
        maxLength={NOTE_MAX}
        placeholder={PLACEHOLDER}
        value={text}
        onChange={(event) => setDraft(event.target.value)}
      />
      {/* 저장 안내와 카운터는 늘 같은 줄에 있다 — "저장됨" 이 나타나고 사라져도 줄이 움직이지 않는다. */}
      <div className="hint">
        <span role="status">{savedTick > 0 ? "저장됨" : ""}</span>
        <span className="my-note__count">{`${text.length} / ${NOTE_MAX}`}</span>
      </div>
    </div>
  );
}
