"use client";

// 첫 말씀 (질문 흐름 마지막). 고른 답에 맞춘 실제 active 카드의 원문과 출처만 보인다 — 예시 구절·등급 배지·풀이를 만들지 않는다.
// 말씀 카드 모양은 정본 말씀 카드(.card.malssum · .src · .scripture)와 같다. 카드에는 화자·등급 값이 없어 출처 줄은 source_label 하나다.
// 행동은 이미 있는 기능만 잇는다: 원문 연결(cardWordsHref) · 브라우저 소리 읽기(useSpeechReader). 형광펜은 원문 화면에서 구절을 고르는 기능이라 여기 두지 않는다.
import type { CardPublic } from "@truewords/api-client-ts/types";
import { CloudOff, Info, RotateCcw, Square, Volume2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { cardWordsHref } from "../../cards/share";
import { useSpeechReader } from "../../library/tts/use-speech-reader";
import { OFFICIAL_NOTICE } from "../pick";
import type { PersonalCardState } from "../use-personal";
import { CrisisNotice } from "./crisis-notice";

/** 까닭 문장의 ‘이름’ 만 굵게. 문장은 pick.ts buildReason 이 만든다. */
function ReasonText({ text }: { text: string }) {
  return (
    <span>
      {text.split(/(‘[^’]+’)/).map((part, index) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: 문장 조각은 순서가 곧 정체다
        part.startsWith("‘") ? <b key={index}>{part}</b> : <span key={index}>{part}</span>,
      )}
    </span>
  );
}

function WordCard({ card }: { card: CardPublic }) {
  const paragraphs = useMemo(() => [{ id: card.id, text: card.text }], [card.id, card.text]);
  const speech = useSpeechReader(paragraphs, card.id);
  // 한국어 음성이 없다고 확인된 기기에서는 버튼을 두지 않는다(null = 아직 모름)
  const canListen = speech.isSupported && speech.hasKoreanVoice !== false;
  const isPlaying = speech.status === "playing";
  return (
    <article className="card malssum onb-word" aria-label={`${card.source_label} 단락`}>
      <div className="src-line">
        <div className="src">{card.source_label}</div>
      </div>
      <p className="scripture">{card.text}</p>
      <div className="onb-word__acts">
        <Link className="btn btn-primary" href={cardWordsHref(card)}>
          이 단락 읽기
        </Link>
        {canListen && (
          <button
            type="button"
            className="btn btn-line"
            aria-pressed={isPlaying}
            onClick={() => (isPlaying ? speech.stop() : speech.play(0))}
          >
            {isPlaying ? <Square size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
            {isPlaying ? "멈추기" : "듣기"}
          </button>
        )}
      </div>
    </article>
  );
}

// 왼쪽 열(제목·까닭)과 오른쪽 열(카드)이 같은 usePersonalCard 상태를 받는다.
export function FirstWordReason({ state }: { state: PersonalCardState }) {
  if (state.status !== "ready" || !state.card) return null;
  return (
    <p className="onb-why onb-result__why">
      <Info size={20} aria-hidden="true" />
      <ReasonText text={state.reason} />
    </p>
  );
}

export function FirstWordBody({ state, isCrisis }: { state: PersonalCardState; isCrisis: boolean }) {
  return (
    <div className="onb-result__card">
      {isCrisis && <CrisisNotice id="onb-result-crisis" />}
      {state.status === "loading" && (
        <div className="card onb-skel" aria-busy="true" role="status" aria-label="말씀을 불러오는 중">
          <span className="skeleton" style={{ width: "58%", height: 14 }} />
          <span className="skeleton" style={{ width: "100%", height: 56 }} />
          <span className="skeleton" style={{ width: "100%", height: 50, marginTop: 6 }} />
        </div>
      )}
      {state.status === "error" && (
        <div className="onb-state" role="alert">
          <p className="onb-state__t">
            <CloudOff size={22} aria-hidden="true" />
            말씀을 받지 못했어요
          </p>
          <p className="onb-state__b">인터넷 연결을 확인하고 다시 받아 주세요. 고르신 답은 그대로 있어요.</p>
          <button type="button" className="btn btn-line btn--pc-auto" onClick={state.retry}>
            <RotateCcw size={20} aria-hidden="true" />
            다시 받기
          </button>
        </div>
      )}
      {state.status === "ready" && state.card && <WordCard card={state.card} />}
      {state.status === "ready" && !state.card && (
        <div className="onb-state" role="status">
          <p className="onb-state__t">오늘 꽂아 둘 말씀이 아직 없어요</p>
          <p className="onb-state__b">고르신 답은 이 기기에 남아 있어요. 홈에서 오늘 훈독을 먼저 시작해 보세요.</p>
        </div>
      )}
      {state.status === "ready" && state.card && (
        <p className="onb-why onb-official">
          <Info size={16} aria-hidden="true" />
          <span>{OFFICIAL_NOTICE}</span>
        </p>
      )}
    </div>
  );
}
