"use client";

// PLAN-HD-011 낭독 목소리 시트 — "1안 조용한 목록" 시안(proposals/voice-picker/refine.html #p1).
// 제목 + 닫기, 얇은 구분선 목록(이름 16px·설명 13px), 선택 표시는 체크 하나, 견본 재생 중엔 스피커.
// 아래에 읽기 속도 0.8/1.0/1.2. 카드 테두리·줄마다 미리 듣기·확인 버튼은 두지 않는다.
// 배경막·포커스 가둠은 <dialog> 가 맡고, Esc·바깥 누르기로 닫으면 포커스는 칩으로 돌아간다(호출자가 opener 를 준다).
import { Check, Volume2 } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, type RefObject, useEffect, useId, useRef } from "react";
import type { ReadAloud } from "./use-read-aloud";
import { SPEECH_RATES } from "./use-speech-reader";
import { DEVICE_VOICE, type VoiceChoice } from "./voice-api";

function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

type Row = { id: VoiceChoice; label: string; description: string };
const DEVICE_ROW: Row = { id: DEVICE_VOICE, label: "기기 음성", description: "이 기기에 들어 있는 목소리" };

export function VoiceSheet({
  reader,
  opener,
  onClose,
}: {
  reader: ReadAloud;
  opener: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const rows: Row[] = reader.voices.length > 0 ? reader.voices : [DEVICE_ROW];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) openDialog(dialog);
    // 열리면 지금 고른 줄(없으면 첫 줄 — Tab 을 받는 줄)로 포커스를 옮긴다.
    listRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
    const chip = opener.current;
    return () => {
      if (chip?.isConnected) chip.focus();
    };
  }, [opener]);

  function close() {
    reader.stopSample();
    onClose();
  }
  // 라디오 그룹 키보드: 방향키로 이웃 줄에 포커스를 옮기며 바로 고른다(끝에서 처음으로 돈다). Tab 은 그룹에 한 번만 선다.
  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const to = (Math.max(from, 0) + step + buttons.length) % buttons.length;
    buttons[to]?.focus();
    reader.selectVoice(rows[to].id);
  }
  // 고른 줄이 없으면(기기 음성으로 읽는 중 AI 목록이 보일 때) 첫 줄이 Tab 을 받는다.
  const tabStop = Math.max(
    rows.findIndex((row) => row.id === reader.choice),
    0,
  );
  function handleBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) close();
  }
  // <dialog> 의 기본 Esc 는 cancel → close 로 이어지지만, showModal 이 없는 환경도 있어 직접 받는다.
  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  }

  return (
    <dialog
      className="sheet vs"
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={close}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
    >
      <div className="sheet__panel vs__panel">
        <div className="vs__head">
          <h2 id={titleId}>낭독 목소리</h2>
          <button type="button" className="vs__close" onClick={close}>
            닫기
          </button>
        </div>
        <div
          className="vs__list"
          role="radiogroup"
          aria-labelledby={titleId}
          ref={listRef}
          onKeyDown={handleListKeyDown}
        >
          {rows.map((row, index) => {
            const isChecked = reader.choice === row.id;
            const isSampling = reader.sampling === row.id;
            return (
              <button
                key={row.id}
                type="button"
                className="vs__row"
                role="radio"
                aria-checked={isChecked}
                tabIndex={index === tabStop ? 0 : -1}
                onClick={() => reader.selectVoice(row.id)}
              >
                <span className="vs__bd">
                  <span className="vs__n">{row.label}</span>
                  <span className="vs__d">{row.description}</span>
                </span>
                <span className="vs__st" aria-hidden="true">
                  {isSampling ? <Volume2 size={20} /> : isChecked ? <Check size={20} strokeWidth={2.5} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        {reader.notice && <p className="vs__note">{reader.notice}</p>}
        <div className="vs__rate">
          <span id={`${titleId}-rate`}>읽기 속도</span>
          <div className="vs__seg" role="group" aria-labelledby={`${titleId}-rate`}>
            {SPEECH_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                aria-pressed={reader.rate === rate}
                aria-label={`${rate.toFixed(1)}배`}
                onClick={() => reader.setRate(rate)}
              >
                {rate.toFixed(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </dialog>
  );
}
