// PLAN-HD-011 AI 낭독 목소리 API 어댑터. 목록(API-HD-044)은 생성 SDK, 단락 mp3(API-HD-045·046)는 바이너리라
// SDK 대신 같은 origin 프록시를 직접 fetch 한다. 텍스트는 보내지 않는다 — 서버가 식별자로 본문을 찾는다.
import { createApiClient } from "@truewords/api-client-ts";
import type { TtsVoice, TtsVoicesResponse } from "@truewords/api-client-ts/types";
import { hoondokFetch } from "../../observability/report";

const BASE = "/api/backend";
const { request } = createApiClient({ baseUrl: BASE, fetch: hoondokFetch });

export type AiVoiceId = TtsVoice["id"];
/** 브라우저 음성(Web Speech). AI 목소리를 쓸 수 없을 때의 대체 경로다. */
export const DEVICE_VOICE = "device" as const;
export type VoiceChoice = AiVoiceId | typeof DEVICE_VOICE;

/** AI 목소리를 쓰지 못하는 이유. null 이면 쓸 수 있다. */
export type AiUnavailable = "loading" | "login" | "disabled" | "quota" | "error";

export class VoiceAudioError extends Error {
  constructor(readonly reason: Exclude<AiUnavailable, "loading">) {
    super(reason);
  }
}

export const voiceAPI = {
  voices: () => request<TtsVoicesResponse>("/hoondok/tts/voices", { cache: "no-store" }),
};

/** 원문 뷰 단락(청크) mp3 경로. */
export function chunkAudioUrl(chunkId: string, voice: AiVoiceId): string {
  return `${BASE}/hoondok/tts/chunks/${encodeURIComponent(chunkId)}?voice=${voice}`;
}

/** 오늘 훈독 말씀의 단락 mp3 경로. 단락 번호는 본문을 빈 줄로 나눈 순서(0부터, splitReadingParagraphs). */
export function readingAudioUrl(readingId: string, paragraph: number, voice: AiVoiceId): string {
  return `${BASE}/hoondok/tts/readings/${encodeURIComponent(readingId)}/${paragraph}?voice=${voice}`;
}

/** 서버 apps/api tts_service.split_paragraphs 와 같은 규칙 — 빈 줄로 나누고 빈 조각은 버린다. */
export function splitReadingParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error_code" in body && typeof body.error_code === "string")
      return body.error_code;
  } catch {
    // 본문이 JSON 이 아니면(프록시 오류 페이지 등) 코드 없음
  }
  return null;
}

/** 단락 mp3 를 받는다. 실패는 VoiceAudioError 로 이유를 구분한다 — 호출자가 브라우저 음성으로 돌아간다. */
export async function fetchVoiceAudio(url: string, signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await hoondokFetch(url, { credentials: "include", signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new VoiceAudioError("error");
  }
  if (response.ok) return response.blob();
  if (response.status === 401) throw new VoiceAudioError("login");
  const code = await errorCode(response);
  if (code === "TTS_QUOTA_EXCEEDED") throw new VoiceAudioError("quota");
  if (code === "TTS_DISABLED") throw new VoiceAudioError("disabled");
  throw new VoiceAudioError("error");
}

/** 목소리 견본(정적 파일, 5초). 줄을 누르면 4초만 들려준다. */
export function voiceSampleUrl(voice: AiVoiceId): string {
  return `/hoondok/voices/${voice}.mp3`;
}
