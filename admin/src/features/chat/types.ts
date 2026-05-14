// 챗봇 입력 화면 ↔ 백엔드 /chat 통신 도메인 타입.

import type { PersonaMode } from "@/components/truewords";
// PoC 정리 (2026-04-29): P2-D Visibility 제거. 운영 인프라 (ChatbotConfig.visibility
// 컬럼 + 백엔드 검증) 도입 시 재추가.
// v3 개편 (2026-05-14): P1-G TheologicalEmphasis 5종 폐기. 강조점은 모드 모듈에 흡수.

export type AnswerMode =
  | "standard"
  | "theological"
  | "pastoral"
  | "beginner"
  | "kids";

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

// 입력 화면에서 sendMessage 에 함께 실어보내는 옵션.
export interface ChatRequestOptions {
  answer_mode?: AnswerMode;
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

// 채팅 화면 메시지 도메인 모델 (UI state 용 — backend response 와 분리).
export interface Message {
  role: "user" | "assistant";
  content: string;
  messageId?: string;
  sources?: ChatResponse["sources"];
  feedback?: FeedbackType;
  // P0-A — 답변 후속 추천 질문 3개. None/빈 배열이면 미노출.
  suggestedFollowups?: string[] | null;
  // P1-J — 기도문/결의문 마무리. 비활성/실패 시 null. ClosingCallout 가 정적 보조멘트로 fallback.
  closing?: string | null;
  // 답변 시점의 답변 모드 — 메시지 옆 아바타 아이콘이 모드 변경에 따라 과거 답변까지 바뀌지 않도록 보존.
  persona?: PersonaMode;
}
