import { throwApiError } from "@/lib/api";
import { parseSSEStream } from "@/lib/sse";
import type {
  AnswerMode,
  TheologicalEmphasis,
} from "@/features/chat/types";

export interface ChatBot {
  chatbot_id: string;
  display_name: string;
  description: string;
}

/**
 * 입력 화면에서 sendMessage 에 함께 실어보내는 옵션.
 */
export interface ChatRequestOptions {
  answer_mode?: AnswerMode;
  theological_emphasis?: TheologicalEmphasis;
}

export interface Source {
  volume: string;
  text: string;
  score: number;
  source: string;
  // P0-B — 원문보기 모달 fetch 용 Qdrant point id.
  chunk_id?: string;
  // admin 인라인 편집으로 지정된 사람 친화적 표시명. null/없음 시 volume fallback.
  display_name?: string | null;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  session_id: string;
  message_id: string;
  // P0-A — 자동 follow-up 추천 (생성 실패/비활성 시 null).
  suggested_followups?: string[] | null;
  // P1-J — 기도문/결의문 마무리 (비활성 시 null).
  closing?: string | null;
  // B5 — 사용자 명시 페르소나가 위기 신호로 pastoral 강제 override 됐는지.
  // True 면 UI 가 "위기 신호로 감지되어 상담 모드로 전환됐어요" 노티 노출.
  persona_overridden?: boolean;
}

export type FeedbackType =
  | "helpful"
  | "inaccurate"
  | "missing_citation"
  | "irrelevant"
  | "other";

export interface FeedbackRequest {
  message_id: string;
  feedback_type: FeedbackType;
  comment?: string;
}

export interface FeedbackResponse {
  id: string;
  message_id: string;
  feedback_type: FeedbackType;
  created_at: string;
}

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
        // 백엔드 schema 통합(W2-③) 전에는 무시되며, 머지 후 자동 검증됨.
        ...(options?.answer_mode ? { answer_mode: options.answer_mode } : {}),
        ...(options?.theological_emphasis
          ? { theological_emphasis: options.theological_emphasis }
          : {}),
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
        ...(options?.theological_emphasis
          ? { theological_emphasis: options.theological_emphasis }
          : {}),
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
