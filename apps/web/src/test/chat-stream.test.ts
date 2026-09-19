import { afterEach, describe, expect, it, vi } from "vitest";
import { chatAPI } from "@/features/chatbot/chat-api";
import fixture from "../../../../contracts/fixtures/chat-stream.json";

afterEach(() => vi.unstubAllGlobals());

function callbacks() {
  return { onChunk: vi.fn(), onSources: vi.fn(), onDone: vi.fn() };
}

function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        // UTF-8 코드포인트와 CRLF가 네트워크 경계에서 나뉘는 경우를 검증한다.
        for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("chatAPI SSE 계약", () => {
  it("공통 fixture의 chunk/sources/done을 순서대로 수신한다", async () => {
    const events = fixture.normal;
    const text = events.map((entry) => `event: ${entry.event}\r\ndata: ${JSON.stringify(entry.data)}\r\n\r\n`).join("");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(text)));
    const cb = callbacks();
    await chatAPI.streamMessage("질문", "test", undefined, undefined, undefined, cb);
    expect(cb.onChunk).toHaveBeenCalled();
    expect(cb.onSources).toHaveBeenCalledWith(events.find((entry) => entry.event === "sources")?.data);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it("done 없이 끊긴 응답은 부분 chunk를 보존하고 완료로 처리하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response('event: chunk\ndata: {"text":"일부 답변"}\n\n')));
    const cb = callbacks();
    await expect(chatAPI.streamMessage("질문", "test", undefined, undefined, undefined, cb)).rejects.toThrow(
      "응답 연결이 종료",
    );
    expect(cb.onChunk).toHaveBeenCalledWith("일부 답변");
    expect(cb.onDone).not.toHaveBeenCalled();
  });

  it("사용자 취소를 완료 이벤트로 바꾸지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("취소", "AbortError")));
    const cb = callbacks();
    await expect(
      chatAPI.streamMessage("질문", "test", undefined, controller.signal, undefined, cb),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cb.onDone).not.toHaveBeenCalled();
  });
});
