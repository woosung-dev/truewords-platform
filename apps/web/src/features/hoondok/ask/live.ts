// 지금 답을 받는 중인 질문 (메모리 전용). 답이 끝나면 서버가 계정에 보관한 기록(`/hoondok/me/asks/{id}`)이 원본이 되고
// 이 값은 그 기록이 화면에 도착할 때까지만 보인다. 기기 저장소에는 아무것도 남기지 않는다.
//
// 요청은 화면 effect 가 아니라 보내기·이어 묻기·다시 시도 클릭에서 시작한다 — 개발 모드 StrictMode 의 effect 이중 실행이
// 요청을 두 번 보내 하루 횟수를 두 번 쓰지 않게 하려는 것이다. 화면을 떠나도 요청은 끝까지 받아 계정에 남긴다.
import { ApiError } from "@truewords/api-client-ts";
import { type AnswerMode, AskError, type AskErrorKind, type AskResult, requestHoondokAsk } from "./ask-stream";
import { publicQuestionsAPI } from "./public-api";

export type LiveStatus = "pending" | "answered" | "no-sources" | "error";

/** 공개 신청 진행(답이 끝난 뒤 자동 신청한 경우). blocked = 공개할 수 없는 답(409·마음 돌봄). */
export type LivePublicOutcome = "submitting" | "done" | "blocked" | "failed";

export type LiveAsk = {
  /** 화면 주소에 쓰는 임시 id (`live-…`). 서버 대화 id 와 겹치지 않는다. */
  key: string;
  /** 질문한 훈독 계정 id. 화면은 지금 로그인한 계정과 같은 것만 그린다(공용 기기에서 계정이 바뀌어도 남의 답이 안 보이게). */
  ownerId: string;
  question: string;
  /** 사용자가 고른 모델. 없으면 자동. */
  answerMode?: AnswerMode;
  /** 이어 묻기면 처음부터, 새 질문이면 sources 이벤트를 받은 뒤 채워진다. */
  sessionId?: string;
  isFollowup: boolean;
  /** 새 질문에서 "공개하고 함께 나누기"를 골랐는지. */
  wantsPublic: boolean;
  status: LiveStatus;
  result?: AskResult;
  errorKind?: AskErrorKind;
  /** 사용자가 그만두기를 눌렀다. */
  isStopped?: boolean;
  publicOutcome?: LivePublicOutcome;
  createdAt: string;
};

let entries: readonly LiveAsk[] = [];
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function patch(key: string, next: Partial<LiveAsk>): void {
  entries = entries.map((entry) => (entry.key === key ? { ...entry, ...next } : entry));
  emit();
}

export function subscribeLiveAsks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore 용 — 바뀔 때만 새 배열이다. */
export function readLiveAsks(): readonly LiveAsk[] {
  return entries;
}

/** 이 계정이 보낸 것만. 로그인 전(ownerId 없음)이면 빈 배열. */
export function liveAsksOf(all: readonly LiveAsk[], ownerId: string | undefined): readonly LiveAsk[] {
  return ownerId ? all.filter((entry) => entry.ownerId === ownerId) : EMPTY_LIVE_ASKS;
}

export const EMPTY_LIVE_ASKS: readonly LiveAsk[] = [];

function newKey(): string {
  try {
    return `live-${crypto.randomUUID()}`;
  } catch {
    return `live-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** 답이 끝나면 부른다 — 서버 기록·남은 횟수 다시 읽기. */
export type LiveSettled = () => void;

async function run(key: string, onSettled: LiveSettled): Promise<void> {
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry) return;
  const controller = new AbortController();
  controllers.set(key, controller);
  try {
    const result = await requestHoondokAsk(entry.question, {
      answerMode: entry.answerMode,
      sessionId: entry.isFollowup ? entry.sessionId : undefined,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    patch(key, {
      status: result.sources.length > 0 ? "answered" : "no-sources",
      result,
      sessionId: result.sessionId,
      errorKind: undefined,
    });
    if (entry.wantsPublic && !entry.isFollowup && result.sources.length > 0) await submitPublic(key, result);
  } catch (error) {
    if (controller.signal.aborted) return;
    patch(key, { status: "error", errorKind: error instanceof AskError ? error.kind : "failed" });
  } finally {
    if (controllers.get(key) === controller) controllers.delete(key);
    onSettled();
  }
}

/** 공개를 고른 첫 답 — 서버가 message_id 로 자기 기록을 복사한다. 마음 돌봄 답은 신청하지 않는다. */
async function submitPublic(key: string, result: AskResult): Promise<void> {
  if (result.resolvedMode === "pastoral") {
    patch(key, { publicOutcome: "blocked" });
    return;
  }
  patch(key, { publicOutcome: "submitting" });
  try {
    await publicQuestionsAPI.submit(result.messageId);
    patch(key, { publicOutcome: "done" });
  } catch (error) {
    patch(key, { publicOutcome: error instanceof ApiError && error.status === 409 ? "blocked" : "failed" });
  }
}

export type StartLiveAsk = {
  ownerId: string;
  question: string;
  answerMode?: AnswerMode;
  /** 있으면 이 대화로 이어 묻는다. */
  sessionId?: string;
  wantsPublic?: boolean;
};

/** 질문을 보내기 시작하고 임시 id 를 돌려준다. 클릭 핸들러에서만 부른다. */
export function startLiveAsk(input: StartLiveAsk, onSettled: LiveSettled): string {
  const key = newKey();
  const entry: LiveAsk = {
    key,
    ownerId: input.ownerId,
    question: input.question,
    answerMode: input.answerMode,
    sessionId: input.sessionId,
    isFollowup: Boolean(input.sessionId),
    wantsPublic: Boolean(input.wantsPublic) && !input.sessionId,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  entries = [...entries, entry];
  emit();
  void run(key, onSettled);
  return key;
}

/** 실패·그만둔 질문을 같은 조건으로 다시 보낸다(횟수를 다시 쓴다). */
export function retryLiveAsk(key: string, onSettled: LiveSettled): void {
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry || entry.status === "pending") return;
  patch(key, { status: "pending", errorKind: undefined, isStopped: false, result: undefined });
  void run(key, onSettled);
}

/** 그만두기 — 요청을 끊는다. 서버가 이미 답을 만들기 시작했으면 횟수는 돌아오지 않는다. */
export function stopLiveAsk(key: string): void {
  controllers.get(key)?.abort();
  controllers.delete(key);
  patch(key, { status: "error", isStopped: true });
}

/** 계정의 받는 중인 질문을 모두 버린다 — 로그아웃·계정 삭제·다른 계정 로그인 때. 진행 중인 요청도 끊는다. */
export function clearLiveAsks(): void {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  entries = [];
  emit();
}
