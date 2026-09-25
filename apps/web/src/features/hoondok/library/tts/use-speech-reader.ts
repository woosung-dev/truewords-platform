"use client";

// PLAN-HD-008 원문 소리 내어 읽기. 브라우저 내장 음성(Web Speech API)만 쓴다 — 서버 TTS·오디오 파일은 비범위다.
// 단락(청크) 하나를 문장으로 쪼개 한 문장씩 이어 말한다. 긴 큐를 한 번에 넣으면 일부 브라우저가 중간에 멈춘다.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type SpeechParagraph = { id: string; text: string };
export type SpeechStatus = "idle" | "playing" | "paused" | "ended";
export const SPEECH_RATES = [0.8, 1.0, 1.2] as const;
export type SpeechRate = (typeof SPEECH_RATES)[number];

/** 이보다 긴 문장은 쉼표에서 한 번 더 나눈다 — 한 발화가 길면 브라우저가 끊기거나 늦게 시작한다. */
const MAX_SENTENCE = 200;

/** 단락을 발화 단위로 나눈다. 문장 끝(. ? ! 。) + 공백, 문단 경계(빈 줄)에서 자르고 긴 문장은 쉼표에서 더 자른다. */
export function splitSentences(text: string): string[] {
  const sentences = text
    .split(/\n\s*\n|(?<=[.?!。])\s+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return sentences.flatMap((sentence) => {
    if (sentence.length <= MAX_SENTENCE) return [sentence];
    const pieces: string[] = [];
    let current = "";
    for (const clause of sentence.split(/(?<=,)\s+/)) {
      if (current && current.length + clause.length + 1 > MAX_SENTENCE) {
        pieces.push(current);
        current = clause;
      } else {
        current = current ? `${current} ${clause}` : clause;
      }
    }
    if (current) pieces.push(current);
    return pieces;
  });
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  if (typeof window.SpeechSynthesisUtterance === "undefined") return null;
  return window.speechSynthesis;
}

function koreanVoice(engine: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  return engine.getVoices().find((voice) => voice.lang?.toLowerCase().replace("_", "-").startsWith("ko"));
}

type ChainContext = {
  engine: SpeechSynthesis;
  paragraphs: SpeechParagraph[];
  rate: number;
  isCurrent: (token: number) => boolean;
  onParagraph: (index: number) => void;
  onFinish: (status: "ended" | "idle") => void;
};

/** 한 문장씩 이어 말한다. 옛 세대(token)의 콜백은 아무것도 바꾸지 않는다. */
function speakChain(ctx: ChainContext, paragraphIndex: number, sentenceIndex: number, token: number): void {
  if (!ctx.isCurrent(token)) return;
  if (paragraphIndex >= ctx.paragraphs.length) {
    ctx.onFinish("ended");
    return;
  }
  const sentences = splitSentences(ctx.paragraphs[paragraphIndex].text);
  if (sentenceIndex >= sentences.length) {
    // 단락 끝(빈 단락 포함) — 다음 단락으로 간다.
    speakChain(ctx, paragraphIndex + 1, 0, token);
    return;
  }
  ctx.onParagraph(paragraphIndex);
  const utterance = new window.SpeechSynthesisUtterance(sentences[sentenceIndex]);
  utterance.lang = "ko-KR";
  const voice = koreanVoice(ctx.engine);
  if (voice) utterance.voice = voice;
  utterance.rate = ctx.rate;
  utterance.onend = () => speakChain(ctx, paragraphIndex, sentenceIndex + 1, token);
  utterance.onerror = (event) => {
    if (!ctx.isCurrent(token)) return;
    // 취소는 세대가 이미 바뀌어 여기까지 오지 않는다. 그 밖의 오류는 멈추고 처음 상태로 둔다.
    if (event.error === "interrupted" || event.error === "canceled") return;
    ctx.onFinish("idle");
  };
  ctx.engine.speak(utterance);
}

const noopSubscribe = () => () => {};
function subscribeVoices(onChange: () => void) {
  const engine = synth();
  engine?.addEventListener?.("voiceschanged", onChange);
  return () => engine?.removeEventListener?.("voiceschanged", onChange);
}
/** 음성 목록이 아직 비어 있으면 모른다(null) — 로드 전에 "한국어 음성 없음" 을 띄우지 않는다. */
function voiceSnapshot(): boolean | null {
  const engine = synth();
  if (!engine) return null;
  if (engine.getVoices().length === 0) return null;
  return Boolean(koreanVoice(engine));
}

/** controlledRate 를 주면 속도는 호출자가 소유한다(PLAN-HD-011 기기 기억값). setRate 는 여전히 읽던 단락부터 다시 읽는다. */
export function useSpeechReader(paragraphs: SpeechParagraph[], resetKey: string | number, controlledRate?: SpeechRate) {
  const isSupported = useSyncExternalStore(
    noopSubscribe,
    () => synth() !== null,
    () => false,
  );
  const hasKoreanVoice = useSyncExternalStore(subscribeVoices, voiceSnapshot, () => null);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);
  // cue 로 멈춘 채 준비만 한 상태 — 아직 한 번도 말하지 않았다. resume 이 그 단락부터 새로 시작한다.
  const [isCued, setIsCued] = useState(false);
  const [rateState, setRateState] = useState<SpeechRate>(controlledRate ?? 1.0);
  const rate = controlledRate ?? rateState;

  // 세대 토큰 — 취소·재시작마다 올린다. cancel() 뒤에 늦게 오는 onend/onerror 는 옛 세대라 무시한다.
  const generation = useRef(0);
  const rateRef = useRef<SpeechRate>(rate);
  const paragraphsRef = useRef(paragraphs);
  useEffect(() => {
    paragraphsRef.current = paragraphs;
  }, [paragraphs]);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  // 구간이 바뀌면 처음 상태로 돌린다(렌더 중 조정 — 이펙트 안 setState 를 피한다).
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setStatus("idle");
    setCurrentIndex(0);
    setIsCued(false);
  }
  // 구간을 바꾸거나 화면을 떠나면 말하던 것을 멈춘다.
  useEffect(
    () => () => {
      generation.current += 1;
      synth()?.cancel();
    },
    [resetKey],
  );

  const start = useCallback((fromIndex: number) => {
    const engine = synth();
    const list = paragraphsRef.current;
    if (!engine || list.length === 0) return;
    generation.current += 1;
    engine.cancel();
    const index = Math.min(Math.max(fromIndex, 0), list.length - 1);
    setIsCued(false);
    setCurrentIndex(index);
    setStatus("playing");
    speakChain(
      {
        engine,
        paragraphs: list,
        rate: rateRef.current,
        isCurrent: (token) => token === generation.current,
        onParagraph: setCurrentIndex,
        onFinish: setStatus,
      },
      index,
      0,
      generation.current,
    );
  }, []);

  const play = useCallback(
    (fromIndex?: number) => start(fromIndex ?? (status === "ended" ? 0 : currentIndex)),
    [start, status, currentIndex],
  );
  /** 말하지 않고 그 단락에 멈춘 상태로 둔다(PLAN-HD-011 대체 경로). iOS 는 제스처 밖의 첫 발화를 막을 수 있어
   * 자동으로 시작하지 않는다 — 사용자가 "이어 듣기" 를 누르면 resume 이 그 단락부터 읽는다. */
  const cue = useCallback((fromIndex: number) => {
    const engine = synth();
    const list = paragraphsRef.current;
    if (!engine || list.length === 0) return;
    generation.current += 1;
    engine.cancel();
    setCurrentIndex(Math.min(Math.max(fromIndex, 0), list.length - 1));
    setIsCued(true);
    setStatus("paused");
  }, []);
  const pause = useCallback(() => {
    const engine = synth();
    if (!engine || status !== "playing") return;
    engine.pause();
    setStatus("paused");
  }, [status]);
  const resume = useCallback(() => {
    const engine = synth();
    if (!engine || status !== "paused") return;
    if (isCued) {
      start(currentIndex);
      return;
    }
    engine.resume();
    setStatus("playing");
  }, [status, isCued, currentIndex, start]);
  const stop = useCallback(() => {
    generation.current += 1;
    synth()?.cancel();
    setIsCued(false);
    setStatus("idle");
    setCurrentIndex(0);
  }, []);
  const setRate = useCallback(
    (next: SpeechRate) => {
      rateRef.current = next;
      setRateState(next);
      // 발화 중 속도는 바뀌지 않는다 — 읽던 단락 처음부터 새 속도로 다시 읽는다.
      if (status === "playing" || status === "paused") start(currentIndex);
    },
    [status, currentIndex, start],
  );

  return { isSupported, hasKoreanVoice, status, currentIndex, rate, isCued, play, cue, pause, resume, stop, setRate };
}
