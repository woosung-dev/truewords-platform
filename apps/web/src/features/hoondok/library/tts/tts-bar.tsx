"use client";

// PLAN-HD-008 듣기 바. 마크업은 프로토타입 오디오 바(docs/prd/prototypes/hoondok-ds/app.html `.audio`)를 따르고
// 시간 표시 대신 "단락 k / n" 을 쓴다 — 단락마다 따로 만들어 전체 길이를 미리 알 수 없다.
// PLAN-HD-011 로 오른쪽 속도 버튼 자리에 낭독 목소리 칩이 들어왔다 — 누르면 목소리·속도 시트(VoiceSheet)가 열린다.
import { ChevronUp, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { ReadAloud } from "./use-read-aloud";
import { VoiceSheet } from "./voice-sheet";

function rateLabel(rate: number): string {
  return `${rate.toFixed(1)}배`;
}

export function TtsBar({
  reader,
  title,
  total,
  nextHref,
}: {
  reader: ReadAloud;
  title: string;
  total: number;
  /** 구간 끝까지 들었을 때 보이는 다음 구간 링크. 자동으로 넘기지 않는다. */
  nextHref: string | null;
}) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  if (!reader.isSupported) {
    // AI 목소리를 쓸 수 있는지 확인하는 동안에는 "지원하지 않음" 을 먼저 띄우지 않는다.
    if (reader.isResolving) return null;
    return (
      <>
        <p className="notice tts-note">이 브라우저는 소리 내어 읽기를 지원하지 않아요.</p>
        {reader.notice && <p className="notice tts-note">{reader.notice}</p>}
      </>
    );
  }
  const isPlaying = reader.status === "playing";
  const isEnded = reader.status === "ended";
  const isActive = isPlaying || reader.status === "paused";
  const position = isEnded ? total : isActive ? reader.currentIndex + 1 : 0;
  const percent = total > 0 ? Math.round((position / total) * 100) : 0;
  const isLoading = reader.isLoading;

  function toggle() {
    if (isPlaying) reader.pause();
    else if (reader.status === "paused") reader.resume();
    else reader.play();
  }
  const playLabel = isLoading
    ? "목소리를 준비하고 있어요"
    : isPlaying
      ? "일시정지"
      : reader.status === "paused"
        ? "이어 듣기"
        : "듣기 시작";

  return (
    <>
      <div className="audio">
        <button
          type="button"
          className="audio__play"
          aria-label={playLabel}
          aria-busy={isLoading || undefined}
          // AI 목소리를 쓸 수 있는지 확인하는 짧은 동안은 누르지 않게 한다 — 기기 음성으로 시작했다가 바뀌지 않게.
          disabled={reader.isResolving}
          onClick={toggle}
        >
          {isLoading ? (
            <span className="btn__spinner" aria-hidden="true" />
          ) : isPlaying ? (
            <Pause size={20} aria-hidden="true" />
          ) : (
            <Play size={20} aria-hidden="true" />
          )}
        </button>
        <span className="audio__bd">
          <span className="audio__meta">
            <b>{title}</b>
            {/* 재생·일시정지 중에만 위치를 보인다. 재생 전·끝난 뒤에는 이 구간의 단락 수만 */}
            <span className="audio__t">{isActive ? `단락 ${position} / ${total}` : `${total}단락`}</span>
          </span>
          <span
            className="progress"
            role="progressbar"
            aria-label="듣기 진행"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={position}
          >
            <i className="progress__fill" style={{ width: `${percent}%` }} />
          </span>
        </span>
        <button
          ref={chipRef}
          type="button"
          className="audio__who"
          aria-haspopup="dialog"
          aria-expanded={isSheetOpen}
          aria-label={`낭독 목소리 ${reader.label}${reader.rate !== 1 ? `, ${rateLabel(reader.rate)}` : ""}, 바꾸기`}
          onClick={() => setIsSheetOpen(true)}
        >
          <span>{reader.label}</span>
          <ChevronUp size={16} aria-hidden="true" />
        </button>
      </div>
      {reader.resumeHint && (
        <p className="notice tts-note" role="status">
          {reader.resumeHint}
        </p>
      )}
      {reader.mode === "device" && reader.hasKoreanVoice === false && (
        <p className="notice tts-note">기기에 한국어 음성이 없어 읽기 품질이 낮을 수 있어요.</p>
      )}
      {isEnded && nextHref && (
        <Link className="btn btn-line btn--sm tts-next" href={nextHref}>
          다음 구간 이어 듣기
        </Link>
      )}
      {isSheetOpen && <VoiceSheet reader={reader} opener={chipRef} onClose={() => setIsSheetOpen(false)} />}
    </>
  );
}
