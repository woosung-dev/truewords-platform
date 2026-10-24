import type { ChatDoneEvent, ChatSourcesEvent, FeaturedMalssum, Source } from "@truewords/api-client-ts/types";
import { parseSSEStream } from "./sse";

type Callbacks = {
  onChunk?: (text: string) => void;
  onSources?: (data: ChatSourcesEvent) => void;
  onDone?: (data: ChatDoneEvent) => void;
};

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const optionalString = (value: unknown) => value === undefined || typeof value === "string";
const nullableString = (value: unknown) => value === null || optionalString(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function source(value: unknown): value is Source {
  return (
    object(value) &&
    typeof value.volume === "string" &&
    typeof value.text === "string" &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    optionalString(value.source) &&
    optionalString(value.chunk_id) &&
    nullableString(value.display_name) &&
    nullableString(value.cited_phrase)
  );
}

function featured(value: unknown): value is FeaturedMalssum {
  return (
    object(value) &&
    typeof value.text === "string" &&
    optionalString(value.category) &&
    optionalString(value.source) &&
    optionalString(value.volume)
  );
}

function sources(value: unknown): value is ChatSourcesEvent {
  return (
    object(value) &&
    Array.isArray(value.sources) &&
    value.sources.every(source) &&
    typeof value.session_id === "string" &&
    typeof value.message_id === "string" &&
    nullableString(value.closing) &&
    (value.suggested_followups == null || strings(value.suggested_followups)) &&
    (value.featured_malssum == null || featured(value.featured_malssum))
  );
}

/** 알려진 이벤트를 검증하고 sources와 done이 모두 도착한 응답만 완료한다. */
export async function consumeChatStream(body: ReadableStream<Uint8Array>, callbacks: Callbacks = {}) {
  const reader = body.getReader();
  const received: { sources?: ChatSourcesEvent; done?: ChatDoneEvent } = {};
  let completed = false;
  const invalid = () => new Error("스트리밍 응답 형식이 올바르지 않아요.");
  try {
    await parseSSEStream(reader, (event) => {
      // 새 이벤트·추가 필드는 구 클라이언트에서도 무시할 수 있다.
      if (!["chunk", "sources", "done"].includes(event.event)) return;
      let value: unknown;
      try {
        value = JSON.parse(event.data);
      } catch {
        throw invalid();
      }
      if (received.done) throw invalid();
      if (event.event === "chunk") {
        if (!object(value) || typeof value.text !== "string") throw invalid();
        callbacks.onChunk?.(value.text);
      } else if (event.event === "sources") {
        if (!sources(value)) throw invalid();
        received.sources = value;
        callbacks.onSources?.(value);
      } else {
        if (!object(value) || typeof value.disclaimer !== "string" || !received.sources) throw invalid();
        received.done = { disclaimer: value.disclaimer };
        callbacks.onDone?.(received.done);
      }
    });
    if (!received.sources || !received.done) throw new Error("응답 연결이 종료되었어요. 다시 시도해주세요.");
    completed = true;
    return { sources: received.sources, done: received.done };
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
