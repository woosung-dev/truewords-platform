import { fetchAPI, throwApiError } from "@/lib/api";
import { parseSSEStream } from "@/lib/sse";
import type {
  ChatRequest, ChatbotConfigResponse, ChatResponse, ChatSourcesEvent, ChatDoneEvent,
  ChatChunkEvent, FeedbackRequest, FeedbackResponse, SessionListResponse,
  SessionHistoryResponse,
} from "@truewords/api-client-ts/types";

export type {
  ChatResponse, Source, FeaturedMalssum, FeedbackType, FeedbackRequest, FeedbackResponse,
  SessionListItem, SessionListResponse, SessionHistoryMessage,
  SessionHistoryResponse as SessionHistory,
} from "@truewords/api-client-ts/types";

// 화면에 필요한 봇 정보만 노출하는 projection이며 별도 API DTO가 아니다.
export type ChatBot = Pick<ChatbotConfigResponse,
  "chatbot_id" | "display_name" | "description" | "streaming_enabled" | "suggested_questions" | "suggested_at"
>;
export type ChatRequestOptions = Pick<ChatRequest,
  "answer_mode" | "participant_name" | "participant_category"
>;

export const chatAPI = {
  listBots: (): Promise<ChatBot[]> => fetchAPI<ChatBot[]>("/chatbots"),

  sendMessage: async (
    query: string,
    chatbotId: string,
    sessionId?: string,
    signal?: AbortSignal,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> => {
    return fetchAPI<ChatResponse>("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "include",
      body: JSON.stringify({
        query,
        chatbot_id: chatbotId,
        session_id: sessionId,
        ...(options?.answer_mode ? { answer_mode: options.answer_mode } : {}),
        ...(options?.participant_name
          ? { participant_name: options.participant_name }
          : {}),
        ...(options?.participant_category
          ? { participant_category: options.participant_category }
          : {}),
      }),
      signal,
    });
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
      onSources: (data: ChatSourcesEvent) => void;
      onDone: (data: ChatDoneEvent) => void;
    },
  ): Promise<void> => {
    const res = await fetch("/api/backend/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "include",
      body: JSON.stringify({
        query,
        chatbot_id: chatbotId,
        session_id: sessionId,
        ...(options?.answer_mode ? { answer_mode: options.answer_mode } : {}),
        ...(options?.participant_name
          ? { participant_name: options.participant_name }
          : {}),
        ...(options?.participant_category
          ? { participant_category: options.participant_category }
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
    let hasDone = false;
    await parseSSEStream(reader, (event) => {
      if (!event.data) return;
      switch (event.event) {
        case "chunk": {
          const parsed = JSON.parse(event.data) as ChatChunkEvent;
          if (parsed.text) callbacks.onChunk(parsed.text);
          return;
        }
        case "sources": {
          callbacks.onSources(JSON.parse(event.data) as ChatSourcesEvent);
          return;
        }
        case "done": {
          hasDone = true;
          callbacks.onDone(JSON.parse(event.data) as ChatDoneEvent);
          return;
        }
        // 그 외 이벤트는 무시 (향후 확장 호환).
      }
    });
    if (!hasDone) throw new Error("응답 연결이 종료되었어요. 다시 시도해주세요.");
  },

  submitFeedback: async (
    payload: FeedbackRequest,
  ): Promise<FeedbackResponse> => {
    return fetchAPI<FeedbackResponse>("/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      // 익명 세션 쿠키(tw_anon_session) 왕복 보장 — 세션별 upsert 식별에 필요.
      credentials: "include",
      body: JSON.stringify(payload),
    });
  },

  // 피드백 취소 — 현재 세션의 해당 메시지 피드백을 서버에서 삭제. 없어도 멱등(204).
  deleteFeedback: async (messageId: string): Promise<void> => {
    await fetchAPI<void>(`/chat/feedback/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
      credentials: "include",
    });
  },

  // 대화 기록 — 로그인 사용자 본인의 지난 세션 목록 (최근 활동순). 로그인 필수.
  listSessions: (): Promise<SessionListResponse> =>
    fetchAPI<SessionListResponse>("/chat/sessions"),

  // 단일 세션 트랜스크립트. 소유자만 열람 가능 (미소유/미존재 시 404).
  getSessionHistory: (sessionId: string): Promise<SessionHistoryResponse> =>
    fetchAPI<SessionHistoryResponse>(`/chat/sessions/${encodeURIComponent(sessionId)}`),
};
