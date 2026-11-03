import { hoondokFetch } from "../observability/report";
// SCR-PWA-005·006 AI 질문 어댑터 — 시연 챗과 같은 `POST /api/backend/chat/stream` SSE 를 소비한다
// (PLAN-HD-002 W2 · §9 2026-09-19 결정). 백엔드·스키마·프롬프트는 건드리지 않는다.
//
// 훈독만의 규칙 둘:
//  1) 이어 묻기 — 새 질문은 `session_id` 없이 새 세션을 열고, 상세 화면의 "이어서 질문하기"만 sources 이벤트로 받은
//     `session_id` 를 다시 보내 같은 대화(서버 12메시지 기억)로 잇는다. 답변 모델은 사용자가 고른 경우에만 보낸다.
//  2) 근거 게이트 — chunk 텍스트를 화면에 바로 흘리지 않고 모아 두었다가 `sources` 가 1건 이상일 때만
//     답과 근거를 함께 보인다. 0건이면 답을 버리고 "확인할 수 없음" 으로 끝낸다(AC-017-01·04).

import type { ChatSourcesEvent, Source } from "@truewords/api-client-ts/types";
import { consumeChatStream } from "@/lib/chat-stream";

/**
 * 훈독 질문이 쓰는 봇 슬러그 (`chatbot_id`, UUID 아님).
 *
 * `[확인 필요]` 훈독 전용 봇·시스템 프롬프트는 미정이라 기존 봇을 재사용한다(PLAN-HD-002 §9).
 * `all`(전체 검색 = 소스 A·B·C, 말씀선집 포함)을 고른 근거는 두 가지다.
 *  - 시연 챗의 운영 기본값이 `all` 이고(`apps/web/src/app/(chat)/page.tsx`) 실제로 근거가 돌아오는 것이 확인된
 *    유일한 슬러그다. 없는 슬러그를 보내면 `/chat/stream` 이 404 를 준다.
 *  - 시드의 `malssum_priority` 는 A 단독 티어의 `score_threshold` 가 0.75 로, RuntimeConfig 가 적은
 *    RRF 점수 범위(0.0~0.5, `apps/api/app/modules/chatbot/runtime_config.py`) 위라 근거 0건이 상시화될 위험이 있다.
 */
export const HOONDOK_ASK_CHATBOT_ID = "all";

/** 서버 답변 모드 5종. 보내지 않으면(자동) 서버가 질문을 보고 고른다. */
export type AnswerMode = ChatSourcesEvent["answer_mode"];

/** 근거 게이트를 통과하기 전의 원자료. sources 가 빈 배열이면 답을 보이지 않는다. */
export type AskResult = {
  answer: string;
  sources: Source[];
  disclaimer: string;
  /** 이어 묻기에 다시 보낼 세션. */
  sessionId: string;
  /** 서버가 기록한 답 메시지 id. 공개 신청(POST /hoondok/me/questions)에 쓴다. */
  messageId: string;
  /** 실제로 적용된 답변 모드. 자동이거나 위기 질문이면 요청과 다를 수 있다. */
  resolvedMode: AnswerMode;
  /** 서버가 제안한 관련 질문. 없으면 빈 배열. */
  followups: string[];
};

export type AskOptions = {
  /** 없으면 자동(서버가 결정). */
  answerMode?: AnswerMode;
  /** 있으면 같은 대화로 이어 묻는다. */
  sessionId?: string;
  signal?: AbortSignal;
};

export type AskErrorKind = "rate-limit" | "failed";

export const ASK_ERROR_MESSAGE: Record<AskErrorKind, string> = {
  "rate-limit": "지금은 질문이 많아요. 잠시 뒤 다시 물어봐 주세요",
  failed: "답을 받지 못했어요",
};

export const ANSWER_MODES: readonly AnswerMode[] = ["standard", "theological", "beginner", "pastoral", "kids"];

export function isAnswerMode(value: unknown): value is AnswerMode {
  return typeof value === "string" && (ANSWER_MODES as readonly string[]).includes(value);
}

export class AskError extends Error {
  readonly kind: AskErrorKind;

  constructor(kind: AskErrorKind) {
    super(ASK_ERROR_MESSAGE[kind]);
    this.name = "AskError";
    this.kind = kind;
  }
}

/** 던져진 값을 화면 문구로. AbortError 는 사용자가 떠난 것이므로 호출자가 먼저 걸러낸다. */
export function askErrorMessage(error: unknown): string {
  return error instanceof AskError ? error.message : ASK_ERROR_MESSAGE.failed;
}

/**
 * 질문 1건을 보내고 답·근거·고지를 모아서 돌려준다.
 *
 * 경로·헤더·이벤트 처리 순서는 시연 챗(`features/chatbot/chat-api.ts`)과 같다 — 같은 프록시를 쓰므로
 * `X-Requested-With` 와 쿠키 동봉도 그대로다. `answer_mode`·`session_id` 는 값이 있을 때만 싣는다.
 */
export async function requestAsk(question: string, options: AskOptions = {}): Promise<AskResult> {
  const { answerMode, sessionId, signal } = options;
  const res = await hoondokFetch("/api/backend/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    credentials: "include",
    body: JSON.stringify({
      query: question,
      chatbot_id: HOONDOK_ASK_CHATBOT_ID,
      ...(answerMode ? { answer_mode: answerMode } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    }),
    signal,
  });
  if (!res.ok) throw new AskError(res.status === 429 ? "rate-limit" : "failed");
  if (!res.body) throw new AskError("failed");

  const chunks: string[] = [];
  try {
    const { sources, done } = await consumeChatStream(res.body, { onChunk: (text) => chunks.push(text) });
    return {
      answer: chunks.join("").trim(),
      sources: sources.sources,
      disclaimer: done.disclaimer,
      sessionId: sources.session_id,
      messageId: sources.message_id,
      // 구 서버(필드 없음)도 화면이 죽지 않게 표준으로 본다
      resolvedMode: isAnswerMode(sources.answer_mode) ? sources.answer_mode : "standard",
      followups: (sources.suggested_followups ?? []).filter((text) => text.trim().length > 0).slice(0, 3),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AskError("failed");
  }
}
