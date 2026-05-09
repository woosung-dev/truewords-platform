// SSE 스트림 파서 회귀 잠금 테스트.
import { describe, it, expect } from "vitest";
import { parseSSEStream, type SSEEvent } from "@/lib/sse";

function streamFromChunks(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return stream.getReader();
}

async function collect(chunks: string[]): Promise<SSEEvent[]> {
  const out: SSEEvent[] = [];
  await parseSSEStream(streamFromChunks(chunks), (e) => out.push(e));
  return out;
}

describe("parseSSEStream", () => {
  it("순차 chunk/sources/done 이벤트를 파싱한다", async () => {
    const events = await collect([
      'event: chunk\ndata: {"text":"안녕"}\n\n',
      'event: chunk\ndata: {"text":"하세요"}\n\n',
      'event: sources\ndata: {"sources":[],"session_id":"s1","message_id":"m1"}\n\n',
      'event: done\ndata: {"disclaimer":"AI 답변"}\n\n',
    ]);
    expect(events.map((e) => e.event)).toEqual(["chunk", "chunk", "sources", "done"]);
    expect(JSON.parse(events[0].data)).toEqual({ text: "안녕" });
    expect(JSON.parse(events[2].data).message_id).toBe("m1");
  });

  it("chunk 가 라인 중간에 끊겨도 정상 파싱한다 (네트워크 분할 시뮬레이션)", async () => {
    const events = await collect([
      "event: chu",
      "nk\ndata: {\"te",
      'xt":"일부"}\n\n',
      'event: done\ndata: {}\n\n',
    ]);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("chunk");
    expect(JSON.parse(events[0].data).text).toBe("일부");
  });

  it("\\r\\n 라인 종결자도 처리한다", async () => {
    const events = await collect([
      "event: chunk\r\ndata: {\"text\":\"x\"}\r\n\r\n",
    ]);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).text).toBe("x");
  });

  it("연속 data: 라인은 \\n 으로 join 된다", async () => {
    const events = await collect([
      "event: chunk\ndata: line1\ndata: line2\n\n",
    ]);
    expect(events[0].data).toBe("line1\nline2");
  });

  it("comment(:로 시작) 와 알 수 없는 필드는 무시한다", async () => {
    const events = await collect([
      ": this is a comment\nevent: chunk\nid: 42\ndata: {\"text\":\"ok\"}\n\n",
    ]);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).text).toBe("ok");
  });

  it("스트림이 빈 라인 없이 끝나도 마지막 이벤트를 flush 한다", async () => {
    const events = await collect([
      "event: chunk\ndata: {\"text\":\"마지막\"}\n",
    ]);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).text).toBe("마지막");
  });
});
