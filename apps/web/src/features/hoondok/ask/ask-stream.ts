import { hoondokFetch } from "../observability/report";
// SCR-PWA-005·006 AI 질문 어댑터 — 시연 챗과 같은 SSE 계약(chunk → sources → done)을 소비한다.
//
//  - AI 질문 화면은 `POST /api/backend/hoondok/ask/stream`(훈독 로그인 필수·하루 횟수 차감·계정에 보관, DEC-PWA-025 2차)을 쓴다.
//    봇은 서버가 정하므로 chatbot_id 를 보내지 않는다.
//  - 원문 뷰 "AI 설명"(library/ai-explain)도 같은 경로를 쓴다. `/chat/stream` 은 관리자 게이트 전용이라 웹에서 부르지 않는다.
//
// 훈독만의 규칙 둘:
//  1) 이어 묻기 — 새 질문은 `session_id` 없이 새 대화를 열고, 상세 화면의 "이어서 질문하기"만 sources 이벤트로 받은
//     `session_id` 를 다시 보내 같은 대화(서버 12메시지 기억)로 잇는다. 답변 모델은 사용자가 고른 경우에만 보낸다.
//  2) 근거 게이트 — chunk 텍스트를 화면에 바로 흘리지 않고 모아 두었다가 `sources` 가 1건 이상일 때만
//     답과 근거를 함께 보인다. 0건이면 답을 버리고 "확인할 수 없음" 으로 끝낸다(AC-017-01·04).

import type { ChatSourcesEvent, Source } from "@truewords/api-client-ts/types";
import { consumeChatStream } from "@/lib/chat-stream";

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

/** 질문 1건의 글자 상한(서버 입력 검증과 같다). 넘으면 서버가 400 INPUT_BLOCKED 로 거절한다. */
export const ASK_QUESTION_MAX = 1000;

/** 서버와 같은 방식(코드 포인트)으로 센 글자 수 — 이모지 하나를 1자로 센다. */
export function askLength(text: string): number {
  return [...text.trim()].length;
}

/**
 * 오류 종류. auth = 훈독 로그인 필요(401) · daily-limit = 하루 횟수 소진(429 ASK_DAILY_LIMIT) ·
 * blocked = 보낼 수 없는 질문(400 INPUT_BLOCKED — 화면이 1000자를 먼저 막으므로 실제로는 빈 질문·차단 표현) ·
 * forbidden = 이어 물을 수 없는 대화(403 SESSION_FORBIDDEN, 다시 시도해도 같다) · rate-limit = 짧은 시간 과다 요청(429).
 */
export type AskErrorKind = "auth" | "daily-limit" | "blocked" | "forbidden" | "rate-limit" | "failed";

export const ASK_ERROR_MESSAGE: Record<AskErrorKind, string> = {
  auth: "질문하려면 훈독 로그인이 필요해요",
  "daily-limit": "오늘 물어볼 수 있는 횟수를 모두 썼어요. 내일 다시 물어볼 수 있어요(자정 초기화)",
  blocked: "이 질문은 보낼 수 없어요. 다른 표현으로 고쳐서 물어봐 주세요",
  forbidden: "이 대화에는 이어 물을 수 없어요. 새 질문으로 물어봐 주세요",
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

/** 오류 응답의 error_code. 본문이 JSON 이 아니거나 모양이 다르면 null. */
async function errorCode(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && typeof (body as { error_code?: unknown }).error_code === "string")
      return (body as { error_code: string }).error_code;
  } catch {
    // 본문 없음·JSON 아님
  }
  return null;
}

async function errorKind(res: Response): Promise<AskErrorKind> {
  if (res.status === 401) return "auth";
  if (res.status === 429) return (await errorCode(res)) === "ASK_DAILY_LIMIT" ? "daily-limit" : "rate-limit";
  if (res.status === 400 && (await errorCode(res)) === "INPUT_BLOCKED") return "blocked";
  if (res.status === 403 && (await errorCode(res)) === "SESSION_FORBIDDEN") return "forbidden";
  return "failed";
}

/**
 * 질문 1건을 보내고 답·근거·고지를 모아서 돌려준다.
 *
 * 같은 origin 프록시(`/api/backend`)에 `X-Requested-With` 와 쿠키를 함께 보낸다. `answer_mode`·`session_id` 는 값이 있을 때만 싣는다.
 */
async function streamAsk(path: string, payload: Record<string, unknown>, options: AskOptions): Promise<AskResult> {
  const { answerMode, sessionId, signal } = options;
  const res = await hoondokFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    credentials: "include",
    body: JSON.stringify({
      ...payload,
      ...(answerMode ? { answer_mode: answerMode } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    }),
    signal,
  });
  if (!res.ok) throw new AskError(await errorKind(res));
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

/** AI 질문 화면·원문 AI 설명용 — `/hoondok/ask/stream`(훈독 로그인 필수, 하루 횟수 1회 차감, 답은 내 계정에 보관). */
export function requestHoondokAsk(question: string, options: AskOptions = {}): Promise<AskResult> {
  return streamAsk("/api/backend/hoondok/ask/stream", { query: question }, options);
}
