// 챗봇 입력 화면 ↔ 백엔드 /chat 통신 (REST + SSE + 피드백) API.

import { throwApiError } from "@/lib/api";
import { parseSSEStream } from "@/lib/sse";
import type {
  ChatBot,
  ChatRequestOptions,
  ChatResponse,
  FeedbackRequest,
  FeedbackResponse,
  Source,
  SourceChunkDetail,
} from "./types";

export const chatAPI = {
  listBots: async (): Promise<ChatBot[]> => {
    const res = await fetch("/api/chatbots");
    if (!res.ok) throw new Error("챗봇 목록 조회 실패");
    return res.json();
  },

  sendMessage: async (
    query: string,
    chatbotId: string,
    sessionId?: string,
    signal?: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        chatbot_id: chatbotId,
        session_id: sessionId,
        ...(options?.answer_mode ? { answer_mode: options.answer_mode } : {}),
      }),
      signal,
    });
    if (!res.ok) {
      await throwApiError(res);
    }
    return res.json();
  },

  /**
   * SSE 스트리밍 chat. 백엔드 /chat/stream (chunk/sources/done 3 이벤트) 소비.
   *
   * - onChunk: 각 텍스트 조각 도착 시 호출. 누적은 호출자 책임.
   * - onSources: sources/session_id/message_id (+ closing/suggested_followups) 도착.
   * - onDone: disclaimer 도착 (스트림 정상 종료 신호).
   * - signal: AbortController.signal 연동. 중단 시 ReadableStream 강제 종료.
   *
   * HTTP 응답이 2xx 가 아니면 throwApiError 로 친절 메시지. 네트워크/파싱 에러는
   * 호출자가 try/catch 로 받는다 — onChunk 로 일부 텍스트가 이미 도착했을 수 있어
   * 호출자가 부분 메시지 보존 정책을 결정한다.
   */
  streamMessage: async (
    query: string,
    chatbotId: string,
    sessionId: string | undefined,
    signal: AbortSignal | undefined,
    options: ChatRequestOptions | undefined,
    callbacks: {
      onChunk: (text: string) => void;
      onSources: (data: {
        sources: Source[];
        session_id: string;
        message_id: string;
        closing?: string | null;
        suggested_followups?: string[] | null;
      }) => void;
      onDone: (data: { disclaimer: string }) => void;
    },
  ): Promise<void> => {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        chatbot_id: chatbotId,
        session_id: sessionId,
        ...(options?.answer_mode ? { answer_mode: options.answer_mode } : {}),
      }),
      signal,
    });
    if (!res.ok) {
      await throwApiError(res);
    }
    if (!res.body) {
      throw new Error("스트리밍 응답이 비어있어요");
    }
    const reader = res.body.getReader();
    await parseSSEStream(reader, (event) => {
      if (!event.data) return;
      switch (event.event) {
        case "chunk": {
          const parsed = JSON.parse(event.data) as { text?: string };
          if (parsed.text) callbacks.onChunk(parsed.text);
          return;
        }
        case "sources": {
          callbacks.onSources(JSON.parse(event.data));
          return;
        }
        case "done": {
          callbacks.onDone(JSON.parse(event.data));
          return;
        }
        // 그 외 이벤트는 무시 (향후 확장 호환).
      }
    });
  },

  // P0-B — 인용 카드 "원문보기" 모달용 청크 fetch.
  // ACL 검증을 위해 chatbot_id 를 함께 전송 (해당 챗봇의 검색 범위 청크만 응답).
  getSourceChunk: async (
    chunkId: string,
    chatbotId: string,
    signal?: AbortSignal,
  ): Promise<SourceChunkDetail> => {
    const url = `/api/sources/chunks/${encodeURIComponent(chunkId)}?chatbot_id=${encodeURIComponent(chatbotId)}`;
    const res = await fetch(url, { signal });
    if (res.status === 404) throw new Error("청크를 찾을 수 없어요");
    if (res.status === 403)
      throw new Error("이 챗봇의 검색 범위에 포함되지 않은 자료입니다");
    if (!res.ok) throw new Error("원문을 불러오지 못했어요");
    return (await res.json()) as SourceChunkDetail;
  },

  submitFeedback: async (
    payload: FeedbackRequest,
  ): Promise<FeedbackResponse> => {
    const res = await fetch("/api/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await throwApiError(res);
    }
    return res.json();
  },
};
