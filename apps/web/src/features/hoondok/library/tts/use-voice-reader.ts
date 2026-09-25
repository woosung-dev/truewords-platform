"use client";

// PLAN-HD-011 AI 목소리 듣기. 단락(청크)마다 서버가 만든 mp3 를 순서대로 재생하고 다음 단락을 미리 받아 둔다.
// 상태 모양은 useSpeechReader 와 같다(듣기 바가 둘을 같은 방식으로 그린다). 실패하면 onFailure 로 알리고 멈춘다 —
// 브라우저 음성으로 이어 읽을지는 호출자(useReadAloud)가 정한다.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechRate, SpeechStatus } from "./use-speech-reader";
import { type AiVoiceId, fetchVoiceAudio, VoiceAudioError } from "./voice-api";

export type VoiceFailure = VoiceAudioError["reason"];

type Options = {
  count: number;
  urlFor: (index: number, voice: AiVoiceId) => string;
  resetKey: string | number;
  rate: SpeechRate;
  /** 받기·재생 실패. index 는 실패한 단락이다. */
  onFailure: (reason: VoiceFailure, index: number) => void;
};

// 0.05초 무음 WAV. 사용자가 누른 그 순간 audio 요소를 한 번 재생해 두면 iOS Safari 가 이후 비동기 play() 를 막지 않는다.
// [가정] mp3 를 받은 뒤(제스처 밖) 부르는 play() 가 iOS 에서 막히는 문제를 이 방식으로 푼다 — 실기기 확인 필요.
function silentWav(): string {
  const samples = 400; // 8kHz × 0.05s
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8bit 무음
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}
let silentSrc: string | null = null;

export function useVoiceReader({ count, urlFor, resetKey, rate, onFailure }: Options) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 세대 토큰 — 시작·정지마다 올린다. 늦게 끝난 받기·ended 는 옛 세대라 무시한다.
  const generation = useRef(0);
  // url → objectURL 약속. 지금 단락과 다음 단락만 남기고 치운다.
  const blobs = useRef(new Map<string, Promise<string>>());
  const pausedWhileLoading = useRef(false);
  const latest = useRef({ count, urlFor, rate, onFailure });
  useEffect(() => {
    latest.current = { count, urlFor, rate, onFailure };
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [count, urlFor, rate, onFailure]);

  const audio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const release = useCallback((keep: Set<string>) => {
    for (const [url, promise] of blobs.current) {
      if (keep.has(url)) continue;
      blobs.current.delete(url);
      void promise.then((src) => URL.revokeObjectURL(src)).catch(() => {});
    }
  }, []);

  const load = useCallback((url: string): Promise<string> => {
    const cached = blobs.current.get(url);
    if (cached) return cached;
    const promise = fetchVoiceAudio(url).then((blob) => URL.createObjectURL(blob));
    blobs.current.set(url, promise);
    // 실패한 약속은 남기지 않는다 — 다음 시도에서 다시 받는다.
    promise.catch(() => blobs.current.delete(url));
    return promise;
  }, []);

  // ended 에서 다음 단락을 부를 때 자기 자신을 참조한다 — 최신 playAt 을 ref 로 건넨다.
  const playAtRef = useRef<(index: number, voice: AiVoiceId, token: number) => Promise<void>>(async () => {});
  const playAt = useCallback(
    async (index: number, voice: AiVoiceId, token: number): Promise<void> => {
      if (token !== generation.current) return;
      const { count: total, urlFor: toUrl } = latest.current;
      if (index >= total) {
        setStatus("ended");
        setIsLoading(false);
        return;
      }
      setCurrentIndex(index);
      const url = toUrl(index, voice);
      const nextUrl = index + 1 < total ? toUrl(index + 1, voice) : null;
      release(new Set([url, ...(nextUrl ? [nextUrl] : [])]));
      let src: string;
      try {
        src = await load(url);
      } catch (error) {
        if (token !== generation.current) return;
        setStatus("idle");
        setIsLoading(false);
        latest.current.onFailure(error instanceof VoiceAudioError ? error.reason : "error", index);
        return;
      }
      if (token !== generation.current) return;
      const element = audio();
      element.src = src;
      element.playbackRate = latest.current.rate;
      element.onended = () => void playAtRef.current(index + 1, voice, token);
      setIsLoading(false);
      if (nextUrl) load(nextUrl).catch(() => {}); // 미리 받기 실패는 그 단락 차례에 다시 시도한다
      if (pausedWhileLoading.current) return;
      try {
        await element.play();
      } catch {
        // 자동 재생이 막혔다(제스처 밖). 멈춘 상태로 두면 사용자가 "이어 듣기" 로 다시 누른다.
        if (token === generation.current) setStatus("paused");
      }
    },
    [audio, load, release],
  );

  useEffect(() => {
    playAtRef.current = playAt;
  }, [playAt]);

  const start = useCallback(
    (fromIndex: number, voice: AiVoiceId) => {
      const total = latest.current.count;
      if (total === 0) return;
      generation.current += 1;
      pausedWhileLoading.current = false;
      const element = audio();
      element.pause();
      // 누른 순간 재생을 한 번 걸어 둔다(iOS 제스처 잠금 해제). 실제 소리는 받은 뒤 바뀐다.
      silentSrc ??= silentWav();
      element.src = silentSrc;
      element.play()?.catch(() => {});
      const index = Math.min(Math.max(fromIndex, 0), total - 1);
      setCurrentIndex(index);
      setStatus("playing");
      setIsLoading(true);
      void playAt(index, voice, generation.current);
    },
    [audio, playAt],
  );

  const pause = useCallback(() => {
    if (status !== "playing") return;
    if (isLoading) pausedWhileLoading.current = true;
    audioRef.current?.pause();
    setStatus("paused");
  }, [status, isLoading]);

  const resume = useCallback(
    (voice: AiVoiceId) => {
      if (status !== "paused") return;
      const element = audioRef.current;
      // 받는 중에 멈췄거나 소리가 아직 걸리지 않았으면 그 단락부터 다시 시작한다.
      if (!element || pausedWhileLoading.current || !element.src.startsWith("blob:")) {
        start(currentIndex, voice);
        return;
      }
      setStatus("playing");
      element.play()?.catch(() => setStatus("paused"));
    },
    [status, currentIndex, start],
  );

  const stop = useCallback(() => {
    generation.current += 1;
    pausedWhileLoading.current = false;
    audioRef.current?.pause();
    setStatus("idle");
    setCurrentIndex(0);
    setIsLoading(false);
  }, []);

  // 구간이 바뀌면 처음 상태로 돌린다(렌더 중 조정 — useSpeechReader 와 같은 방식).
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setStatus("idle");
    setCurrentIndex(0);
    setIsLoading(false);
  }
  // 구간을 바꾸거나 화면을 떠나면 재생을 멈추고 받아 둔 소리를 치운다.
  useEffect(
    () => () => {
      generation.current += 1;
      audioRef.current?.pause();
      release(new Set());
    },
    [resetKey, release],
  );

  return { status, currentIndex, isLoading, start, pause, resume, stop };
}
