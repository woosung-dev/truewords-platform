"use client";

// PLAN-HD-011 듣기 통합. AI 목소리(useVoiceReader)가 기본이고, 못 쓰면 브라우저 음성(useSpeechReader, PLAN-HD-008)이
// 대체 경로다. 못 쓰는 경우: 목록 API 실패·키 없음(enabled=false)·이번 달 상한·비로그인·재생 중 받기 실패.
// 재생 중 실패로 바뀔 때는 자동으로 말하지 않고 그 단락에 멈춰 둔다(iOS 제스처 제한) — 사용자가 "이어 듣기" 를 누른다.
// 일시적 실패(busy·error)는 고정하지 않는다 — 기기 음성으로 읽는 동안만 기기 음성이고, 멈추면 다음 재생은 AI 로 다시 시도한다.
// 목소리·속도 선택은 기기에 기억한다(voice-prefs). 줄을 누르면 즉시 선택하고, 본문을 듣는 중이 아니면 견본 4초를 들려준다.
import { useQuery } from "@tanstack/react-query";
import type { TtsVoice } from "@truewords/api-client-ts/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { TTS_VOICES_KEY } from "../../query-keys";
import { type SpeechParagraph, type SpeechRate, useSpeechReader } from "./use-speech-reader";
import { useVoiceReader, type VoiceFailure } from "./use-voice-reader";
import {
  type AiUnavailable,
  type AiVoiceId,
  DEVICE_VOICE,
  type VoiceChoice,
  voiceAPI,
  voiceSampleUrl,
} from "./voice-api";
import { useVoicePrefs, writeVoicePrefs } from "./voice-prefs";

export const SAMPLE_MS = 4000;
const FALLBACK_VOICE: AiVoiceId = "sulafat";

const NOTICES: Record<AiUnavailable, string | null> = {
  loading: null,
  login: "로그인하면 AI 목소리로 들을 수 있어요.",
  disabled: "AI 목소리가 아직 준비되지 않아 기기 음성으로 읽어요.",
  quota: "이번 달 AI 낭독 한도에 도달해 기기 음성으로 읽어요.",
  daily: "오늘 AI 낭독을 많이 들어 기기 음성으로 읽어요.",
  busy: "요청이 많아 잠시 기기 음성으로 읽어요.",
  error: "AI 목소리를 불러오지 못해 기기 음성으로 읽어요.",
};
const TRANSIENT: ReadonlySet<VoiceFailure> = new Set<VoiceFailure>(["busy", "error"]);

export function useReadAloud(
  paragraphs: SpeechParagraph[],
  resetKey: string | number,
  urlFor: (index: number, voice: AiVoiceId) => string,
) {
  const prefs = useVoicePrefs();
  const identity = useCurrentUser();
  const voicesQuery = useQuery({
    queryKey: TTS_VOICES_KEY,
    queryFn: voiceAPI.voices,
    retry: false,
    staleTime: 5 * 60_000,
  });
  // 재생 중 받기에 실패한 이유. 한도·로그인 등은 이 방문 동안 기기 음성으로 읽고, 일시적 실패는 기기 음성으로 읽는 동안만이다.
  const [failure, setFailure] = useState<VoiceFailure | null>(null);

  const speech = useSpeechReader(paragraphs, resetKey, prefs.rate);
  const speechRef = useRef(speech);
  useEffect(() => {
    speechRef.current = speech;
  });

  const onFailure = useCallback((reason: VoiceFailure, index: number) => {
    setFailure(reason);
    // 끊긴 단락에 기기 음성을 멈춘 채 준비해 둔다 — 받기가 끝난 뒤(제스처 밖)라 바로 말하면 iOS 가 막을 수 있다.
    // 기기 음성도 없으면 멈춘 채 안내만 남는다.
    if (speechRef.current.isSupported) speechRef.current.cue(index);
  }, []);
  const voice = useVoiceReader({ count: paragraphs.length, urlFor, resetKey, rate: prefs.rate, onFailure });

  const isSpeechBusy = speech.status === "playing" || speech.status === "paused";
  let unavailable: AiUnavailable | null = null;
  if (voicesQuery.isPending || identity.isLoading) unavailable = "loading";
  else if (voicesQuery.isError || !voicesQuery.data) unavailable = "error";
  else if (!voicesQuery.data.enabled) unavailable = "disabled";
  else if (voicesQuery.data.limit_reached) unavailable = "quota";
  else if (!identity.user) unavailable = "login";
  if (failure && (!TRANSIENT.has(failure) || isSpeechBusy)) unavailable = failure;
  const isAi = unavailable === null;

  const aiVoices: TtsVoice[] = voicesQuery.data?.voices ?? [];
  const selectedAi: AiVoiceId =
    prefs.voice && prefs.voice !== DEVICE_VOICE ? prefs.voice : (voicesQuery.data?.default_voice ?? FALLBACK_VOICE);
  // 지금 소리를 내고 있는 쪽이 모드를 정한다 — 확인 중(loading)에 기기 음성으로 시작했다가 AI 가 켜져도
  // 읽던 소리가 화면 상태와 어긋나지 않게. 둘 다 쉬고 있으면 AI 를 쓸 수 있을 때 AI 다.
  const isVoiceBusy = voice.status === "playing" || voice.status === "paused";
  const mode: "ai" | "device" = isSpeechBusy ? "device" : isVoiceBusy || isAi ? "ai" : "device";
  const active = mode === "ai" ? voice : speech;

  // --- 견본 4초 -------------------------------------------------------------
  const sampleRef = useRef<HTMLAudioElement | null>(null);
  const sampleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sampling, setSampling] = useState<AiVoiceId | null>(null);
  const stopSample = useCallback(() => {
    if (sampleTimer.current) clearTimeout(sampleTimer.current);
    sampleTimer.current = null;
    sampleRef.current?.pause();
    setSampling(null);
  }, []);
  const playSample = useCallback(
    (id: AiVoiceId) => {
      stopSample();
      sampleRef.current ??= new Audio();
      const element = sampleRef.current;
      element.src = voiceSampleUrl(id);
      element.playbackRate = prefs.rate;
      element.onended = stopSample;
      element.play()?.catch(stopSample);
      setSampling(id);
      sampleTimer.current = setTimeout(stopSample, SAMPLE_MS);
    },
    [prefs.rate, stopSample],
  );
  useEffect(() => stopSample, [stopSample]);

  const isBusy = isSpeechBusy || isVoiceBusy;

  const play = useCallback(
    (fromIndex?: number) => {
      stopSample();
      const index = fromIndex ?? (active.status === "ended" ? 0 : active.currentIndex);
      if (mode === "ai") voice.start(index, selectedAi);
      else speech.play(index);
    },
    [stopSample, active.status, active.currentIndex, mode, voice, speech, selectedAi],
  );
  const pause = useCallback(() => (mode === "ai" ? voice.pause() : speech.pause()), [mode, voice, speech]);
  const resume = useCallback(
    () => (mode === "ai" ? voice.resume(selectedAi) : speech.resume()),
    [mode, voice, speech, selectedAi],
  );
  const stop = useCallback(() => {
    voice.stop();
    speech.stop();
  }, [voice, speech]);

  const setRate = useCallback(
    (next: SpeechRate) => {
      writeVoicePrefs({ ...prefs, rate: next });
      // AI 는 playbackRate 가 바로 바뀐다(훅 effect). 기기 음성은 읽던 단락부터 새 속도로 다시 읽는다.
      if (mode === "device") speech.setRate(next);
      if (sampleRef.current) sampleRef.current.playbackRate = next;
    },
    [prefs, mode, speech],
  );

  /** 줄을 누르면 즉시 선택한다. 본문을 듣는 중이면 현재 단락부터 새 목소리로, 아니면 견본 4초. */
  const selectVoice = useCallback(
    (next: VoiceChoice) => {
      // "기기 음성" 은 AI 를 못 쓸 때 시트에 남는 유일한 줄이라 고를 것이 없다 — 기억하지 않는다.
      if (next === DEVICE_VOICE || !isAi) {
        stopSample();
        return;
      }
      writeVoicePrefs({ ...prefs, voice: next });
      const index = active.currentIndex;
      if (isBusy) {
        stopSample();
        speech.stop();
        voice.start(index, next);
        return;
      }
      playSample(next);
    },
    [prefs, active.currentIndex, stopSample, isBusy, voice, speech, isAi, playSample],
  );

  const choice: VoiceChoice = mode === "ai" ? selectedAi : DEVICE_VOICE;
  const label = choice === DEVICE_VOICE ? "기기 음성" : (aiVoices.find((v) => v.id === choice)?.label ?? "AI 목소리");

  return {
    mode,
    /** 이 화면에서 소리 내어 읽을 수 있는가. AI 가 되면 브라우저 음성이 없어도 된다. */
    isSupported: mode === "ai" || speech.isSupported,
    /** AI 를 쓸 수 있는지 아직 확인 중. 기기 음성도 없는 브라우저는 이 동안 아무것도 보이지 않는다. */
    isResolving: unavailable === "loading",
    hasKoreanVoice: mode === "device" ? speech.hasKoreanVoice : true,
    status: active.status,
    currentIndex: active.currentIndex,
    isLoading: mode === "ai" && voice.isLoading,
    rate: prefs.rate,
    choice,
    label,
    /** 시트에 보일 AI 목소리. 못 쓰면 빈 배열이고 시트는 "기기 음성" 한 줄만 보인다. */
    voices: isAi ? aiVoices : [],
    notice: unavailable ? NOTICES[unavailable] : null,
    /** AI 가 끊겨 기기 음성을 멈춘 채 준비해 둔 동안 듣기 바에 보일 한 줄. */
    resumeHint: speech.isCued && unavailable ? `${NOTICES[unavailable]} 이어 듣기를 눌러 주세요.` : null,
    sampling,
    play,
    pause,
    resume,
    stop,
    setRate,
    selectVoice,
    stopSample,
  };
}

export type ReadAloud = ReturnType<typeof useReadAloud>;
