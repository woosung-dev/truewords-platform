// PLAN-HD-011 단락 mp3 받기 — 요청 빈도 제한(429 RATE_LIMIT_EXCEEDED)은 짧게 재시도하는 일시적 오류이고,
// 한도 오류 코드는 이유별로 구분한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/hoondok/observability/report", () => ({ hoondokFetch: vi.fn() }));

import { fetchVoiceAudio, RATE_LIMIT_RETRY_MS, VoiceAudioError } from "@/features/hoondok/library/tts/voice-api";
import { hoondokFetch } from "@/features/hoondok/observability/report";

const URL_ = "/api/backend/hoondok/tts/chunks/c0?voice=sulafat";

function json(status: number, error_code: string): Response {
  return new Response(JSON.stringify({ error_code, message: "x" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const mp3 = () => new Response("mp3", { status: 200, headers: { "content-type": "audio/mpeg" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(hoondokFetch).mockReset();
});
afterEach(() => vi.useRealTimers());

describe("fetchVoiceAudio", () => {
  it("요청 빈도 제한이면 잠깐 기다렸다 다시 받는다", async () => {
    vi.mocked(hoondokFetch).mockResolvedValueOnce(json(429, "RATE_LIMIT_EXCEEDED")).mockResolvedValueOnce(mp3());
    const pending = fetchVoiceAudio(URL_);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_MS[0]);
    expect((await pending).size).toBe(3);
    expect(hoondokFetch).toHaveBeenCalledTimes(2);
  });

  it("재시도해도 계속 막히면 일시적 실패(busy)로 알린다", async () => {
    vi.mocked(hoondokFetch).mockImplementation(async () => json(429, "RATE_LIMIT_EXCEEDED"));
    const pending = fetchVoiceAudio(URL_).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_MS[0] + RATE_LIMIT_RETRY_MS[1]);
    const error = await pending;
    expect(error).toBeInstanceOf(VoiceAudioError);
    expect((error as VoiceAudioError).reason).toBe("busy");
    expect(hoondokFetch).toHaveBeenCalledTimes(RATE_LIMIT_RETRY_MS.length + 1);
  });

  it.each([
    [429, "TTS_QUOTA_EXCEEDED", "quota"],
    [429, "TTS_USER_LIMIT_EXCEEDED", "daily"],
    [503, "TTS_DISABLED", "disabled"],
    [504, "TTS_TIMEOUT", "error"],
  ])("%i %s 는 재시도하지 않고 %s 로 알린다", async (status, code, reason) => {
    vi.mocked(hoondokFetch).mockResolvedValueOnce(json(status, code));
    await expect(fetchVoiceAudio(URL_)).rejects.toMatchObject({ reason });
    expect(hoondokFetch).toHaveBeenCalledTimes(1);
  });
});
