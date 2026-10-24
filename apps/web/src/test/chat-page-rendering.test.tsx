import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ChatPage from "@/app/(chat)/page";
import { chatAPI } from "@/features/chatbot/chat-api";
import fixture from "../../../../contracts/fixtures/chat-stream.json";

const { renderAnswer } = vi.hoisted(() => ({ renderAnswer: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/chat/components/assistant-message", () => ({
  AssistantMessage: (props: { content: string }) => {
    renderAnswer(props.content);
    return <p>{props.content}</p>;
  },
  ClosingCallout: () => null,
}));
vi.mock("@/features/chatbot/chat-api", () => ({ chatAPI: { listBots: vi.fn(), streamMessage: vi.fn() } }));
const pending = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  localStorage.setItem("tw_participant_name", "시연");
  localStorage.setItem("tw_participant_category", "테스트");
  vi.mocked(chatAPI.listBots).mockResolvedValue([
    { chatbot_id: "all", display_name: "전체", description: "", streaming_enabled: true },
  ]);
});
afterEach(() => localStorage.clear());

it("입력과 새 답변 chunk가 지난 답변을 다시 렌더하지 않는다", async () => {
  const first = pending();
  const second = pending();
  vi.mocked(chatAPI.streamMessage).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChatPage />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText("질문 입력");
  // 챗봇 조회가 완료된 뒤 전송한다.
  await screen.findByText("전체에게 질문해 보세요");
  fireEvent.change(input, { target: { value: "첫 질문" } });
  fireEvent.click(screen.getByRole("button", { name: "질문 보내기" }));
  const callbacks = vi.mocked(chatAPI.streamMessage).mock.calls[0][5];
  await act(async () => {
    callbacks.onChunk("첫 번째 답변");
    callbacks.onSources(
      fixture.normal.find((e) => e.event === "sources")!.data as Parameters<typeof callbacks.onSources>[0],
    );
    first.resolve();
  });
  const previousRenders = renderAnswer.mock.calls.filter(([text]) => text === "첫 번째 답변").length;
  expect(previousRenders).toBeGreaterThan(0);
  const next = screen.getByPlaceholderText("메시지를 입력하세요 (Shift+Enter로 줄바꿈)");
  fireEvent.change(next, { target: { value: "이어서 질문" } });
  fireEvent.keyDown(next, { key: "Enter", isComposing: true });
  expect(chatAPI.streamMessage).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(next, { key: "Enter" });
  await act(async () => {
    vi.mocked(chatAPI.streamMessage).mock.calls[1][5].onChunk("새 답변");
    second.resolve();
  });
  expect(renderAnswer.mock.calls.filter(([text]) => text === "첫 번째 답변")).toHaveLength(previousRenders);
});
