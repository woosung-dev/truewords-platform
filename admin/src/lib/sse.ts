// Server-Sent Events (SSE) 스트림을 파싱하여 이벤트 단위로 콜백 호출.
// 백엔드 chat/stream 의 chunk/sources/done 3종 이벤트 수신용. 의존성 0.
//
// SSE 프로토콜 minimal subset:
//  - 라인 분리: \n 또는 \r\n
//  - 빈 라인이 이벤트 경계
//  - event:<name>      → 이벤트 타입 (없으면 "message")
//  - data:<payload>    → 데이터. 같은 이벤트 내 여러 data 라인은 \n 으로 join
//  - 그 외 라인(comment ":..." 등) 은 무시

export interface SSEEvent {
  event: string;
  data: string;
}

export type SSEHandler = (event: SSEEvent) => void;

/**
 * ReadableStream 의 reader 를 끝까지 읽으며 SSE 이벤트를 파싱하여 onEvent 호출.
 * 호출자는 fetch().body.getReader() 결과를 넘기면 된다.
 */
export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: SSEHandler,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "";
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) {
      eventType = "";
      return;
    }
    onEvent({
      event: eventType || "message",
      data: dataLines.join("\n"),
    });
    eventType = "";
    dataLines = [];
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      flush();
      return;
    }
    buffer += decoder.decode(value, { stream: true });

    let lineEnd: number;
    while ((lineEnd = buffer.indexOf("\n")) >= 0) {
      const rawLine = buffer.slice(0, lineEnd);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      buffer = buffer.slice(lineEnd + 1);

      if (line === "") {
        flush();
      } else if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        // 사양상 "data: " 의 공백 1개만 trim. 그 이상 공백/탭은 보존.
        const v = line.slice(5);
        dataLines.push(v.startsWith(" ") ? v.slice(1) : v);
      }
      // 그 외 라인은 무시 (comment, retry, id 등)
    }
  }
}
