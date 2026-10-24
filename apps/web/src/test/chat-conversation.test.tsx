import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatConversation } from "@/features/chat/use-chat-conversation";
import { type ChatBot, chatAPI } from "@/features/chatbot/chat-api";
import fixture from "../../../../contracts/fixtures/chat-stream.json";

vi.mock("@/features/chatbot/chat-api", () => ({
  chatAPI: {
    streamMessage: vi.fn(),
    sendMessage: vi.fn(),
    getSessionHistory: vi.fn(),
    submitFeedback: vi.fn(),
    deleteFeedback: vi.fn(),
  },
}));
const bot = { chatbot_id: "all", display_name: "전체", description: "", streaming_enabled: true } satisfies ChatBot;
const source = fixture.normal.find((event) => event.event === "sources")!.data;
type Callbacks = Parameters<typeof chatAPI.streamMessage>[5];
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.restoreAllMocks());

describe("대화 진행 module", () => {
  it("같은 이벤트 루프의 중복 전송을 한 번만 보낸다", async () => {
    const pending = deferred<void>();
    vi.mocked(chatAPI.streamMessage).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useChatConversation(bot, {}));
    act(() => {
      void result.current.send("첫 질문");
      void result.current.send("중복");
    });
    expect(chatAPI.streamMessage).toHaveBeenCalledOnce();
    expect(result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    await act(async () => pending.resolve());
  });

  it("초기화 뒤 옛 chunk·sources·완료가 새 요청을 바꾸지 못한다", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    vi.mocked(chatAPI.streamMessage).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useChatConversation(bot, {}));
    act(() => {
      void result.current.send("이전");
    });
    const old = vi.mocked(chatAPI.streamMessage).mock.calls[0][5];
    act(() => {
      result.current.reset();
    });
    act(() => {
      void result.current.send("새 질문");
    });
    await act(async () => {
      old.onChunk("늦은 답");
      old.onSources(source as Parameters<Callbacks["onSources"]>[0]);
      first.resolve();
    });
    expect(result.current.messages.map((message) => message.content)).toEqual(["새 질문", ""]);
    expect(result.current.loading).toBe(true);
    await act(async () => second.resolve());
    expect(result.current.loading).toBe(false);
  });

  it("세션 복원 중 새 대화를 시작하면 늦은 복원을 버린다", async () => {
    window.history.replaceState(null, "", "/?session=old");
    const history = deferred<Awaited<ReturnType<typeof chatAPI.getSessionHistory>>>();
    vi.mocked(chatAPI.getSessionHistory).mockReturnValue(history.promise);
    const { result } = renderHook(() => useChatConversation(bot, {}));
    act(() => result.current.reset());
    await act(async () =>
      history.resolve({
        session_id: "old",
        messages: [{ role: "USER", content: "옛 질문", created_at: "2026-01-01" }],
      }),
    );
    expect(result.current.messages).toEqual([]);
  });

  it("비스트림 답과 세션을 보존해 다음 질문을 이어 보낸다", async () => {
    vi.mocked(chatAPI.sendMessage).mockResolvedValue({ answer: "답", ...source } as Awaited<
      ReturnType<typeof chatAPI.sendMessage>
    >);
    const { result } = renderHook(() => useChatConversation({ ...bot, streaming_enabled: false }, {}));
    await act(async () => result.current.send("질문"));
    expect(result.current.messages[1].content).toBe("답");
    await act(async () => result.current.send("이어서"));
    expect(chatAPI.sendMessage).toHaveBeenLastCalledWith(
      "이어서",
      "all",
      source.session_id,
      expect.any(AbortSignal),
      expect.any(Object),
    );
  });

  it("사용자 중단 시 부분 답을 보존한다", async () => {
    vi.mocked(chatAPI.streamMessage).mockImplementation(async (_q, _b, _s, signal, _o, cb) => {
      cb.onChunk("받은 답");
      await new Promise<void>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new DOMException("취소", "AbortError"))),
      );
    });
    const { result } = renderHook(() => useChatConversation(bot, {}));
    act(() => {
      void result.current.send("질문");
    });
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages[1].content).toContain("받은 답");
    expect(result.current.messages[1].content).toContain("중단했습니다");
  });
});
