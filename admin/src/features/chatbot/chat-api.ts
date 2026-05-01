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
      const text = await res.text();
      throw new Error(text || `요청 실패 (${res.status})`);
    }
    return res.json();
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
      const text = await res.text();
      throw new Error(text || `피드백 전송 실패 (${res.status})`);
    }
    return res.json();
  },
};
