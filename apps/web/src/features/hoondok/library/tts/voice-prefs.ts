// PLAN-HD-011 선택한 목소리·읽기 속도를 기기에 기억한다. 서버에 저장하지 않는다.
// 서버 렌더와 첫 하이드레이션은 저장값 없이(null) 그리고, 이후 localStorage 값으로 바꾼다(useSyncExternalStore).
import { useMemo, useSyncExternalStore } from "react";
import { SPEECH_RATES, type SpeechRate } from "./use-speech-reader";
import { DEVICE_VOICE, type VoiceChoice } from "./voice-api";

export const VOICE_PREFS_KEY = "hoondok:tts:prefs";
const CHANGE_EVENT = "hoondok:tts:prefs";
const VOICE_IDS = new Set<string>(["sulafat", "aoede", "algieba", "iapetus", DEVICE_VOICE]);

export type VoicePrefs = { voice: VoiceChoice | null; rate: SpeechRate };
const DEFAULT_PREFS: VoicePrefs = { voice: null, rate: 1.0 };

// 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)는 이번 방문 동안만 이 값으로 기억한다.
let memory: string | null = null;
let isStorageBlocked = false;

/** 테스트 전용 — 모듈 전역 기억을 비운다. */
export function resetVoicePrefsMemory(): void {
  memory = null;
  isStorageBlocked = false;
}

function readRaw(): string | null {
  if (isStorageBlocked) return memory;
  try {
    return window.localStorage.getItem(VOICE_PREFS_KEY);
  } catch {
    return memory;
  }
}

export function parseVoicePrefs(raw: string | null): VoicePrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_PREFS;
    const voice =
      "voice" in value && typeof value.voice === "string" && VOICE_IDS.has(value.voice) ? value.voice : null;
    const rate =
      "rate" in value && SPEECH_RATES.includes(value.rate as SpeechRate)
        ? (value.rate as SpeechRate)
        : DEFAULT_PREFS.rate;
    return { voice: voice as VoiceChoice | null, rate };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writeVoicePrefs(prefs: VoicePrefs): void {
  memory = JSON.stringify(prefs);
  try {
    window.localStorage.setItem(VOICE_PREFS_KEY, memory);
  } catch {
    isStorageBlocked = true;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useVoicePrefs(): VoicePrefs {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parseVoicePrefs(raw), [raw]);
}
