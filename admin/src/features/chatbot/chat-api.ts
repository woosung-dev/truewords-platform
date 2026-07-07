import { throwApiError } from "@/lib/api";
import { parseSSEStream } from "@/lib/sse";
import type { AnswerMode } from "@/features/chat/types";

export interface ChatBot {
  chatbot_id: string;
  display_name: string;
  description: string;
  // 봇별 SSE 스트리밍 응답 활성화. default true. false 면 chat 화면이 비스트림 분기.
  streaming_enabled?: boolean;
  // 입력 화면 추천 질문 칩 — backend cron (매일 03:30 KST) 이 30 일 질문 + RAG sample 로
  // 자동 생성. 빈 배열이면 page.tsx 가 FALLBACK_PROMPTS 4 개로 fallback.
  suggested_questions?: string[];
  // 마지막 cron 갱신 시각 (ISO). null 이면 한 번도 안 돌렸음 → fallback.
  suggested_at?: string | null;
}

/**
 * 입력 화면에서 sendMessage 에 함께 실어보내는 옵션.
 */
export interface ChatRequestOptions {
  answer_mode?: AnswerMode;
  // 레드팀 시연 — 루트 게이트에서 입력받은 참여자 식별 정보. 모든 요청에 동봉.
  participant_name?: string;
  participant_category?: string;
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
  // [deprecated] PR #163 에서 INLINE_CITATIONS 추출 폐기 + 종교 도메인 fit 위해
  // highlight 자체 제거됨. 옛 cache payload 후방호환 위해 타입만 보존, 항상 null.
  cited_phrase?: string | null;
}

// 레드팀 시연 — 답변에 곁들이는 무작위 말씀 (의미 검색 아닌 랜덤). 목록 비면 null.
export interface FeaturedMalssum {
  text: string;
  // category = 주제(테마), source = 출처 그룹, volume = 권 상세
  category?: string;
  source?: string;
  volume?: string;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  session_id: string;
  message_id: string;
  // 레드팀 시연 — 답변 화면 카드용 무작위 말씀.
  featured_malssum?: FeaturedMalssum | null;
  // P0-A — 자동 follow-up 추천 (생성 실패/비활성 시 null).
  suggested_followups?: string[] | null;
  // P1-J — 기도문/결의문 마무리 (비활성 시 null).
  closing?: string | null;
  // B5 — 사용자 명시 페르소나가 위기 신호로 pastoral 강제 override 됐는지.
  // True 면 UI 가 "위기 신호로 감지되어 상담 모드로 전환됐어요" 노티 노출.
  persona_overridden?: boolean;
}

export type FeedbackType =
  // 긍정 — helpful 은 "그냥 좋아요/기타" 기본 버킷, 나머지는 세분 사유
  | "helpful"
  | "accurate"
  | "well_cited"
  | "easy_to_understand"
  | "comforting"
  // 부정
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
        featured_malssum?: FeaturedMalssum | null;
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
