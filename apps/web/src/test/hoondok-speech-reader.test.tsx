// PLAN-HD-008 원문 듣기 훅. 브라우저 speechSynthesis 를 가짜로 바꿔 발화 순서·세대 토큰·정리 동작을 본다.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitSentences, useSpeechReader } from "@/features/hoondok/library/tts/use-speech-reader";

class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

let spoken: FakeUtterance[];
let voices: { lang: string; name: string }[];
let engine: {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  getVoices: () => typeof voices;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

const PARAGRAPHS = [
  { id: "c0", text: "첫 문장입니다. 둘째 문장입니다." },
  { id: "c1", text: "다음 단락입니다." },
];

/** 가장 최근 발화를 끝낸다 — 브라우저가 onend 를 부른 것처럼. */
function finishLast() {
  act(() => spoken[spoken.length - 1].onend?.());
}

beforeEach(() => {
  spoken = [];
  voices = [{ lang: "ko-KR", name: "유나" }];
  engine = {
    speak: vi.fn((utterance: FakeUtterance) => spoken.push(utterance)),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, "speechSynthesis", { value: engine, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(window, "speechSynthesis");
  Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
});

describe("splitSentences", () => {
  it("문장 끝과 빈 줄에서 나눈다", () => {
    expect(splitSentences("하나입니다. 둘인가요? 셋!\n\n넷째 문단")).toEqual([
      "하나입니다.",
      "둘인가요?",
      "셋!",
      "넷째 문단",
    ]);
  });
  it("200자가 넘는 문장은 쉼표에서 더 나눈다", () => {
    const clause = "가".repeat(90);
    const pieces = splitSentences(`${clause}, ${clause}, ${clause}.`);
    expect(pieces).toHaveLength(2);
    expect(pieces.every((piece) => piece.length <= 200)).toBe(true);
  });
});

describe("useSpeechReader", () => {
  it("문장을 차례로 읽고 단락이 끝나면 다음 단락으로, 마지막엔 ended", () => {
    const { result } = renderHook(() => useSpeechReader(PARAGRAPHS, "p1"));
    expect(result.current.isSupported).toBe(true);
    expect(result.current.hasKoreanVoice).toBe(true);
    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
    expect(spoken.map((u) => u.text)).toEqual(["첫 문장입니다."]);
    expect(spoken[0].lang).toBe("ko-KR");
    expect(spoken[0].voice).toEqual(voices[0]);
    finishLast();
    expect(spoken[1].text).toBe("둘째 문장입니다.");
    expect(result.current.currentIndex).toBe(0);
    finishLast();
    expect(spoken[2].text).toBe("다음 단락입니다.");
    expect(result.current.currentIndex).toBe(1);
    finishLast();
    expect(result.current.status).toBe("ended");
    expect(spoken).toHaveLength(3);
  });
  it("일시정지·이어 듣기는 엔진에 그대로 전한다", () => {
    const { result } = renderHook(() => useSpeechReader(PARAGRAPHS, "p1"));
    act(() => result.current.play());
    act(() => result.current.pause());
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("paused");
    act(() => result.current.resume());
    expect(engine.resume).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("playing");
  });
  it("멈춘 뒤 늦게 온 onend 는 다음 문장을 읽게 하지 않는다", () => {
    const { result } = renderHook(() => useSpeechReader(PARAGRAPHS, "p1"));
    act(() => result.current.play());
    const stale = spoken[0];
    act(() => result.current.stop());
    act(() => stale.onend?.());
    expect(spoken).toHaveLength(1);
    expect(result.current.status).toBe("idle");
  });
  it("속도를 바꾸면 현재 단락 처음부터 새 속도로 다시 읽는다", () => {
    const { result } = renderHook(() => useSpeechReader(PARAGRAPHS, "p1"));
    act(() => result.current.play(1));
    expect(spoken[0].text).toBe("다음 단락입니다.");
    const cancelsBefore = engine.cancel.mock.calls.length;
    act(() => result.current.setRate(1.2));
    expect(engine.cancel.mock.calls.length).toBe(cancelsBefore + 1);
    expect(spoken[1]).toMatchObject({ text: "다음 단락입니다.", rate: 1.2 });
    expect(result.current.rate).toBe(1.2);
    // 옛 발화의 onend 는 무시된다
    act(() => spoken[0].onend?.());
    expect(spoken).toHaveLength(2);
  });
  it("화면을 떠나면 읽던 것을 취소한다", () => {
    const { result, unmount } = renderHook(() => useSpeechReader(PARAGRAPHS, "p1"));
    act(() => result.current.play());
    engine.cancel.mockClear();
    unmount();
    expect(engine.cancel).toHaveBeenCalledTimes(1);
  });
  it("구간이 바뀌면 취소하고 처음 상태로 돌아간다", () => {
    const { result, rerender } = renderHook(({ page }) => useSpeechReader(PARAGRAPHS, page), {
      initialProps: { page: "p1" },
    });
    act(() => result.current.play(1));
    engine.cancel.mockClear();
    rerender({ page: "p2" });
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
    expect(result.current.currentIndex).toBe(0);
  });
  it("한국어 음성이 없으면 알리고, 음성 목록이 비면 아직 모른다", () => {
    voices = [{ lang: "en-US", name: "Samantha" }];
    const { result } = renderHook(() => useSpeechReader(PARAGRAPHS, "p1"));
    expect(result.current.hasKoreanVoice).toBe(false);
    voices = [];
    const { result: empty } = renderHook(() => useSpeechReader(PARAGRAPHS, "p1"));
    expect(empty.current.hasKoreanVoice).toBeNull();
  });
  it("speechSynthesis 가 없으면 지원하지 않음으로 보고 아무것도 하지 않는다", () => {
    Reflect.deleteProperty(window, "speechSynthesis");
    const { result } = renderHook(() => useSpeechReader(PARAGRAPHS, "p1"));
    expect(result.current.isSupported).toBe(false);
    act(() => result.current.play());
    expect(result.current.status).toBe("idle");
  });
});
