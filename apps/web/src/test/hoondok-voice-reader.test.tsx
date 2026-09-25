// PLAN-HD-011 AI 낭독 목소리 — 시트 열기/닫기·포커스 복귀, 선택 즉시 반영·기억·견본, 재생 중 목소리 변경 시
// 현재 단락부터 다시, 꺼짐·상한·받기 실패 시 브라우저 음성으로 대체.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { TtsVoicesResponse } from "@truewords/api-client-ts/types";
import { useCallback, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/identity/api", () => ({ identityAPI: { me: vi.fn() } }));
vi.mock("@/features/hoondok/library/tts/voice-api", async (original) => ({
  ...(await original<object>()),
  voiceAPI: { voices: vi.fn() },
  fetchVoiceAudio: vi.fn(),
}));

import { TtsBar } from "@/features/hoondok/library/tts/tts-bar";
import { SAMPLE_MS, useReadAloud } from "@/features/hoondok/library/tts/use-read-aloud";
import {
  type AiVoiceId,
  chunkAudioUrl,
  fetchVoiceAudio,
  VoiceAudioError,
  voiceAPI,
} from "@/features/hoondok/library/tts/voice-api";
import { resetVoicePrefsMemory, VOICE_PREFS_KEY } from "@/features/hoondok/library/tts/voice-prefs";
import { identityAPI } from "@/features/identity/api";

const VOICES: TtsVoicesResponse = {
  enabled: true,
  limit_reached: false,
  default_voice: "sulafat",
  voices: [
    { id: "sulafat", label: "차분한 여성", description: "따뜻하고 낮은 톤" },
    { id: "aoede", label: "맑은 여성", description: "밝고 가벼운 톤" },
    { id: "algieba", label: "부드러운 남성", description: "매끄럽고 편안한 톤" },
    { id: "iapetus", label: "또렷한 남성", description: "단정하고 분명한 톤" },
  ],
};
const PARAGRAPHS = [
  { id: "c0", text: "첫째 단락" },
  { id: "c1", text: "둘째 단락" },
  { id: "c2", text: "셋째 단락" },
];

function Harness() {
  const paragraphs = useMemo(() => PARAGRAPHS, []);
  const urlFor = useCallback(
    (index: number, voice: AiVoiceId) => chunkAudioUrl(paragraphs[index].id, voice),
    [paragraphs],
  );
  const reader = useReadAloud(paragraphs, "page-1", urlFor);
  return (
    <>
      <TtsBar reader={reader} title="듣기 · 1구간" total={paragraphs.length} nextHref={null} />
      <output data-testid="state">{`${reader.mode}:${reader.status}:${reader.currentIndex}`}</output>
    </>
  );
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

// --- 오디오·음성 합성 대역 ---------------------------------------------------------
type Played = { src: string; rate: number; element: HTMLMediaElement };
let played: Played[] = [];
let spoken: { text: string; onend: (() => void) | null }[] = [];

function installSpeech() {
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak: (utterance: { text: string; onend: (() => void) | null }) => spoken.push(utterance),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: () => [{ lang: "ko-KR", name: "유나" }],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    value: class {
      onend: (() => void) | null = null;
      constructor(readonly text: string) {}
    },
  });
}

/** 실제 mp3 재생만 모은다(iOS 잠금 해제용 무음 data: 는 뺀다). */
const mp3Plays = () => played.filter((item) => !item.src.startsWith("data:"));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetVoicePrefsMemory();
  played = [];
  spoken = [];
  vi.mocked(identityAPI.me).mockResolvedValue({ user: { id: "u1", email: "a@b.c", display_name: "효진" } });
  vi.mocked(voiceAPI.voices).mockResolvedValue(VOICES);
  vi.mocked(fetchVoiceAudio).mockImplementation(async (url: string) => new Blob([url], { type: "audio/mpeg" }));
  let objectUrls = 0;
  URL.createObjectURL = vi.fn(() => {
    objectUrls += 1;
    return `blob:mp3-${objectUrls}`;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    played.push({ src: this.src, rate: this.playbackRate, element: this });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "speechSynthesis");
  Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
});

async function clickPlay() {
  const button = await screen.findByRole("button", { name: "듣기 시작" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

async function openSheet() {
  const chip = await screen.findByRole("button", { name: /낭독 목소리 차분한 여성|낭독 목소리 .*바꾸기/ });
  fireEvent.click(chip);
  return { chip, dialog: await screen.findByRole("dialog", { name: "낭독 목소리" }) };
}

describe("낭독 목소리 시트", () => {
  it("칩에서 열고 Esc·바깥 누르기·닫기로 닫으며 포커스는 칩으로 돌아간다", async () => {
    show();
    const chip = await screen.findByRole("button", { name: "낭독 목소리 차분한 여성, 바꾸기" });
    expect(chip).toHaveAttribute("aria-haspopup", "dialog");
    expect(chip).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(chip);
    const dialog = await screen.findByRole("dialog", { name: "낭독 목소리" });
    expect(chip).toHaveAttribute("aria-expanded", "true");
    const radios = within(dialog).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual([
      "차분한 여성따뜻하고 낮은 톤",
      "맑은 여성밝고 가벼운 톤",
      "부드러운 남성매끄럽고 편안한 톤",
      "또렷한 남성단정하고 분명한 톤",
    ]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(radios[0]); // 열리면 고른 줄로 포커스
    // 속도 세그먼트가 시트로 옮겨 왔다 — 바에는 속도 버튼이 없다
    expect(within(dialog).getByRole("button", { name: "1.0배" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(chip);
    expect(chip).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(chip);
    fireEvent.click(await screen.findByRole("dialog")); // 배경막(dialog 자신) 누르기
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(chip);

    fireEvent.click(chip);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(chip);
  });

  it("줄을 누르면 즉시 선택·기억하고 그 목소리 견본을 4초 들려준다", async () => {
    show();
    const { dialog, chip } = await openSheet();
    vi.useFakeTimers();
    fireEvent.click(within(dialog).getByRole("radio", { name: /맑은 여성/ }));

    expect(within(dialog).getByRole("radio", { name: /맑은 여성/ })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("radio", { name: /차분한 여성/ })).toHaveAttribute("aria-checked", "false");
    expect(chip).toHaveAccessibleName("낭독 목소리 맑은 여성, 바꾸기");
    expect(JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) ?? "{}")).toEqual({ voice: "aoede", rate: 1 });
    expect(played.at(-1)?.src).toMatch(/\/hoondok\/voices\/aoede\.mp3$/);
    // 재생 중인 줄 오른쪽에 스피커
    expect(dialog.querySelector(".lucide-volume-2")).not.toBeNull();
    act(() => vi.advanceTimersByTime(SAMPLE_MS));
    expect(dialog.querySelector(".lucide-volume-2")).toBeNull();
    expect(dialog.querySelector(".lucide-check")).not.toBeNull();
    // 본문은 재생하지 않았다(견본만)
    expect(fetchVoiceAudio).not.toHaveBeenCalled();
  });

  it("기억한 목소리·속도로 다시 열린다", async () => {
    localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ voice: "iapetus", rate: 1.2 }));
    show();
    const chip = await screen.findByRole("button", { name: "낭독 목소리 또렷한 남성, 1.2배, 바꾸기" });
    fireEvent.click(chip);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /또렷한 남성/ })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("button", { name: "1.2배" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "0.8배" }));
    expect(JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) ?? "{}")).toEqual({ voice: "iapetus", rate: 0.8 });
  });

  it("localStorage 가 막혀도 선택은 이번 방문 동안 유지된다", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    show();
    const { dialog, chip } = await openSheet();
    fireEvent.click(within(dialog).getByRole("radio", { name: /부드러운 남성/ }));
    expect(chip).toHaveAccessibleName("낭독 목소리 부드러운 남성, 바꾸기");
  });
});

describe("AI 목소리 재생", () => {
  it("단락 mp3 를 순서대로 재생하고 다음 단락을 미리 받는다", async () => {
    show();
    await clickPlay();
    await waitFor(() => expect(mp3Plays()).toHaveLength(1));
    expect(fetchVoiceAudio).toHaveBeenCalledWith("/api/backend/hoondok/tts/chunks/c0?voice=sulafat");
    // 다음 단락 미리 받기
    await waitFor(() =>
      expect(fetchVoiceAudio).toHaveBeenCalledWith("/api/backend/hoondok/tts/chunks/c1?voice=sulafat"),
    );
    expect(screen.getByTestId("state")).toHaveTextContent("ai:playing:0");
    expect(screen.getByText("단락 1 / 3")).toBeInTheDocument();

    act(() => {
      mp3Plays()[0].element.dispatchEvent(new Event("ended"));
    });
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("ai:playing:1"));
    await waitFor(() => expect(mp3Plays()).toHaveLength(2));
    // 이미 받아 둔 c1 은 다시 받지 않는다
    expect(vi.mocked(fetchVoiceAudio).mock.calls.filter(([url]) => url.includes("/c1?")).length).toBe(1);
  });

  it("첫 합성을 기다리는 동안 재생 버튼이 로딩 상태다", async () => {
    let finish: (blob: Blob) => void = () => {};
    vi.mocked(fetchVoiceAudio).mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
    show();
    await clickPlay();
    const busy = await screen.findByRole("button", { name: "목소리를 준비하고 있어요" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    await act(async () => finish(new Blob(["x"])));
    expect(await screen.findByRole("button", { name: "일시정지" })).not.toHaveAttribute("aria-busy");
  });

  it("재생 중 목소리를 바꾸면 현재 단락부터 새 목소리로 이어 읽는다(견본 없음)", async () => {
    show();
    await clickPlay();
    await waitFor(() => expect(mp3Plays()).toHaveLength(1));
    act(() => {
      mp3Plays()[0].element.dispatchEvent(new Event("ended"));
    });
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("ai:playing:1"));

    const { dialog } = await openSheet();
    fireEvent.click(within(dialog).getByRole("radio", { name: /또렷한 남성/ }));
    await waitFor(() =>
      expect(fetchVoiceAudio).toHaveBeenCalledWith("/api/backend/hoondok/tts/chunks/c1?voice=iapetus"),
    );
    expect(fetchVoiceAudio).not.toHaveBeenCalledWith("/api/backend/hoondok/tts/chunks/c0?voice=iapetus");
    expect(screen.getByTestId("state")).toHaveTextContent("ai:playing:1");
    expect(played.some((item) => item.src.includes("/hoondok/voices/"))).toBe(false);
  });

  it("속도는 재생 속도(playbackRate)로 바로 바뀐다", async () => {
    show();
    await clickPlay();
    await waitFor(() => expect(mp3Plays()).toHaveLength(1));
    const { dialog } = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "1.2배" }));
    await waitFor(() => expect(mp3Plays()[0].element.playbackRate).toBe(1.2));
  });
});

describe("브라우저 음성 대체", () => {
  it("키가 없으면(enabled=false) 기기 음성만 보이고 안내 한 줄을 둔다", async () => {
    installSpeech();
    vi.mocked(voiceAPI.voices).mockResolvedValue({ ...VOICES, enabled: false });
    show();
    const chip = await screen.findByRole("button", { name: "낭독 목소리 기기 음성, 바꾸기" });
    fireEvent.click(chip);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["기기 음성이 기기에 들어 있는 목소리"]);
    expect(within(dialog).getByText("AI 목소리가 아직 준비되지 않아 기기 음성으로 읽어요.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));

    fireEvent.click(screen.getByRole("button", { name: "듣기 시작" }));
    expect(spoken.map((item) => item.text)).toEqual(["첫째 단락"]);
    expect(fetchVoiceAudio).not.toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("device:playing:0");
  });

  it("이번 달 상한에 도달했으면 기기 음성으로 읽는다", async () => {
    installSpeech();
    vi.mocked(voiceAPI.voices).mockResolvedValue({ ...VOICES, limit_reached: true });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "낭독 목소리 기기 음성, 바꾸기" }));
    expect(
      within(await screen.findByRole("dialog")).getByText("이번 달 AI 낭독 한도에 도달해 기기 음성으로 읽어요."),
    ).toBeInTheDocument();
  });

  it("비로그인은 AI 를 부르지 않고 로그인 안내를 둔다", async () => {
    installSpeech();
    vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "unauthorized" }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "낭독 목소리 기기 음성, 바꾸기" }));
    expect(
      within(await screen.findByRole("dialog")).getByText("로그인하면 AI 목소리로 들을 수 있어요."),
    ).toBeInTheDocument();
  });

  it("재생 중 상한(429)에 걸리면 그 단락부터 기기 음성으로 이어 읽는다", async () => {
    installSpeech();
    vi.mocked(fetchVoiceAudio).mockImplementation(async (url: string) => {
      if (url.includes("/c1?")) throw new VoiceAudioError("quota");
      return new Blob([url]);
    });
    show();
    await clickPlay();
    await waitFor(() => expect(mp3Plays()).toHaveLength(1));
    act(() => {
      mp3Plays()[0].element.dispatchEvent(new Event("ended"));
    });
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("device:playing:1"));
    expect(spoken.map((item) => item.text)).toEqual(["둘째 단락"]);
    expect(screen.getByRole("button", { name: "낭독 목소리 기기 음성, 바꾸기" })).toBeInTheDocument();
  });

  it("목록 API 가 실패하고 기기 음성도 없으면 지원하지 않음 안내만 보인다", async () => {
    vi.mocked(voiceAPI.voices).mockRejectedValue(new TypeError("Failed to fetch"));
    show();
    expect(await screen.findByText("이 브라우저는 소리 내어 읽기를 지원하지 않아요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "듣기 시작" })).toBeNull();
  });
});
