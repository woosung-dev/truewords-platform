import { describe, expect, it, vi } from "vitest";
import { consumeChatStream } from "@/lib/chat-stream";
import fixture from "../../../../contracts/fixtures/chat-stream.json";

function body(events: { event: string; data: unknown }[]) {
  const bytes = new TextEncoder().encode(
    events.map((e) => `event: ${e.event}\r\ndata: ${JSON.stringify(e.data)}\r\n\r\n`).join(""),
  );
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2));
      controller.close();
    },
  });
}

describe("공통 chat stream 완료 판정", () => {
  it.each(["normal", "meta"] as const)("%s 계약과 UTF-8 분할을 처리한다", async (kind) => {
    const onChunk = vi.fn();
    const result = await consumeChatStream(body([{ event: "future", data: { extra: true } }, ...fixture[kind]]), {
      onChunk,
    });
    expect(result.sources).toEqual(fixture[kind].find((e) => e.event === "sources")?.data);
    expect(result.done.disclaimer).toBe("테스트용 면책 안내");
    expect(onChunk).toHaveBeenCalled();
  });

  it.each([
    ["sources 뒤 끊김", fixture.normal.slice(0, -1)],
    ["sources 누락", fixture.normal.filter((e) => e.event !== "sources")],
    ["chunk 타입 불일치", [{ event: "chunk", data: { text: 1 } }, ...fixture.normal]],
    [
      "출처 항목 타입 불일치",
      [{ event: "sources", data: { sources: [{ volume: 1 }], session_id: "s", message_id: "m" } }],
    ],
    ["done 타입 불일치", [...fixture.normal.slice(0, -1), { event: "done", data: { disclaimer: null } }]],
  ])("%s이면 완료 콜백을 부르지 않는다", async (_name, events) => {
    const onDone = vi.fn();
    await expect(consumeChatStream(body(events), { onDone })).rejects.toThrow();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("취소 오류를 보존하고 reader 잠금을 해제한다", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new DOMException("취소", "AbortError"));
      },
    });
    await expect(consumeChatStream(stream)).rejects.toMatchObject({ name: "AbortError" });
    expect(stream.locked).toBe(false);
  });

  it("타입 불일치로 실패하면 열린 전송을 취소한다", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: chunk\ndata: {"text":null}\n\n'));
      },
      cancel,
    });
    await expect(consumeChatStream(stream)).rejects.toThrow("형식");
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
});
