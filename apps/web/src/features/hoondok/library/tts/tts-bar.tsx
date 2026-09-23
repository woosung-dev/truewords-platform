"use client";

// PLAN-HD-008 듣기 바. 마크업은 프로토타입 오디오 바(docs/prd/prototypes/hoondok-ds/app.html `.audio`)를 따르고
// 시간 표시 대신 "단락 k / n" 을 쓴다 — 브라우저 음성은 전체 길이를 미리 알 수 없다.
import { Pause, Play } from "lucide-react";
import Link from "next/link";
import { SPEECH_RATES, type SpeechRate, type useSpeechReader } from "./use-speech-reader";

type Reader = ReturnType<typeof useSpeechReader>;

function nextRate(rate: SpeechRate): SpeechRate {
  return SPEECH_RATES[(SPEECH_RATES.indexOf(rate) + 1) % SPEECH_RATES.length];
}

function rateLabel(rate: SpeechRate): string {
  return `${rate.toFixed(1)}배`;
}

export function TtsBar({
  reader,
  title,
  total,
  nextHref,
}: {
  reader: Reader;
  title: string;
  total: number;
  /** 구간 끝까지 들었을 때 보이는 다음 구간 링크. 자동으로 넘기지 않는다. */
  nextHref: string | null;
}) {
  if (!reader.isSupported) {
    return <p className="notice tts-note">이 브라우저는 소리 내어 읽기를 지원하지 않아요.</p>;
  }
  const isPlaying = reader.status === "playing";
  const isEnded = reader.status === "ended";
  const isActive = isPlaying || reader.status === "paused";
  const position = isEnded ? total : isActive ? reader.currentIndex + 1 : 0;
  const percent = total > 0 ? Math.round((position / total) * 100) : 0;

  function toggle() {
    if (isPlaying) reader.pause();
    else if (reader.status === "paused") reader.resume();
    else reader.play();
  }

  return (
    <>
      <div className="audio">
        <button
          type="button"
          className="audio__play"
          aria-label={isPlaying ? "일시정지" : reader.status === "paused" ? "이어 듣기" : "듣기 시작"}
          onClick={toggle}
        >
          {isPlaying ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
        </button>
        <span className="audio__bd">
          <b>{title}</b>
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
        <span className="audio__t">
          단락 {position} / {total}
        </span>
        <button
          type="button"
          className="audio__rate"
          aria-label={`읽기 속도 ${rateLabel(reader.rate)}, 눌러서 바꾸기`}
          onClick={() => reader.setRate(nextRate(reader.rate))}
        >
          {rateLabel(reader.rate)}
        </button>
      </div>
      {reader.hasKoreanVoice === false && (
        <p className="notice tts-note">기기에 한국어 음성이 없어 읽기 품질이 낮을 수 있어요.</p>
      )}
      {isEnded && nextHref && (
        <Link className="btn btn-line btn--sm tts-next" href={nextHref}>
          다음 구간 이어 듣기
        </Link>
      )}
    </>
  );
}
