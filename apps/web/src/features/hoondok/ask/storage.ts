// SCR-PWA-005·006 AI 질문 기록 — 기기 전용 저장소 (PLAN-HD-002 W2, REQ-PWA-015).
// 질문·답·근거는 이 브라우저 localStorage 한 키(JSON 배열)에 둔다. 서버에는 `/chat/stream` 대화 기록만 남고,
// 사용자가 "공개"를 고른 질문만 message_id 로 공개 신청한다(서버가 자기 기록을 복사하고 협회가 검수한다).
// 저장소는 없거나 던질 수 있으므로(사생활 모드·차단) 모든 접근을 try/catch 로 감싼다 — note/storage.ts 와 같은 규칙.

import type { MyPublicQuestionItem, Source } from "@truewords/api-client-ts/types";
import { safeLocalStorage as storage } from "@/lib/safe-storage";
import { type AnswerMode, isAnswerMode } from "./ask-stream";

const KEY = "hoondok:ask:items";
// note·install 의 이벤트와 분리한다 — 질문 기록 변경이 다른 화면을 다시 그리지 않게.
const CHANGE_EVENT = "hoondok:ask-change";

/** 보관 상한. 넘으면 오래된 것부터 버린다(배열 앞이 최신). */
export const ASK_MAX = 50;

/** 답변 상태. pending 은 아직 스트리밍 전이라 상세 화면이 마운트될 때 요청을 시작한다. */
export type AskStatus = "pending" | "answered" | "no-sources" | "error";

/** 이어서 질문한 한 턴. 첫 질문·답은 AskItem 본체에 있다(기존 저장 데이터와 같은 모양). */
export type AskTurn = {
  id: string;
  question: string;
  status: AskStatus;
  createdAt: string;
  answer?: string;
  sources?: Source[];
  disclaimer?: string;
  errorMessage?: string;
  resolvedMode?: AnswerMode;
  followups?: string[];
};

export type AskVisibility = "private" | "public";

/**
 * 공개 신청 상태. 서버 값(pending·published·hidden)에 기기만 아는 "blocked"(공개할 수 없는 답 — 마음 돌봄·위기·409)
 * 를 더했다. 비어 있으면 아직 신청하지 않았다.
 */
export type AskPublicStatus = MyPublicQuestionItem["status"] | "blocked";

export type AskItem = {
  id: string;
  question: string;
  status: AskStatus;
  /** ISO 8601 UTC. 표시할 때만 KST 로 바꾼다. */
  createdAt: string;
  answer?: string;
  /** `/chat/stream` 의 sources 이벤트 항목 그대로 (생성 SDK 타입). */
  sources?: Source[];
  disclaimer?: string;
  /** 오류 안내 문구. status 가 error 일 때만 쓴다. */
  errorMessage?: string;
  /** 저장 토글. 기본 false 이며 AI 질문 홈의 "저장" 탭이 센다. */
  isSaved?: boolean;
  /** 서버 대화 세션. 있으면 "이어서 질문하기"가 같은 대화로 잇는다. */
  sessionId?: string;
  /** 첫 답의 서버 메시지 id — 공개 신청에 쓴다. */
  messageId?: string;
  /** 이어서 질문한 턴들(오래된 순). */
  turns?: AskTurn[];
  /** 사용자가 고른 답변 모델. 없으면 자동. */
  answerMode?: AnswerMode;
  /** 서버가 실제로 적용한 모델(SSE answer_mode). */
  resolvedMode?: AnswerMode;
  /** 첫 답의 관련 질문(서버 suggested_followups). */
  followups?: string[];
  /** 공개 여부. 없으면 비공개. */
  visibility?: AskVisibility;
  publicId?: string;
  publicStatus?: AskPublicStatus;
};

const STATUSES: readonly AskStatus[] = ["pending", "answered", "no-sources", "error"];
const PUBLIC_STATUSES: readonly AskPublicStatus[] = ["pending", "published", "hidden", "blocked"];

type Fields = Record<string, unknown>;

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const strList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;
const sourceList = (value: unknown): Source[] | undefined =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Source =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Fields).volume === "string" &&
          typeof (entry as Fields).text === "string",
      )
    : undefined;
const status = (value: unknown): AskStatus => (STATUSES.includes(value as AskStatus) ? (value as AskStatus) : "error");
const mode = (value: unknown): AnswerMode | undefined => (isAnswerMode(value) ? value : undefined);

/** undefined 값은 키째 뺀다 — 저장 JSON 과 테스트 비교가 깔끔해진다. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** 답 본문 공통 필드. 모양이 다른 값은 버리고 빈 칸으로 둔다(하위호환: 예전 항목에는 새 필드가 없다). */
function answerFields(item: Fields) {
  return {
    status: status(item.status),
    answer: str(item.answer),
    sources: sourceList(item.sources),
    disclaimer: str(item.disclaimer),
    errorMessage: str(item.errorMessage),
    resolvedMode: mode(item.resolvedMode),
    followups: strList(item.followups),
  };
}

function parseTurn(value: unknown): AskTurn | null {
  if (typeof value !== "object" || value === null) return null;
  const turn = value as Fields;
  if (typeof turn.id !== "string" || typeof turn.question !== "string" || typeof turn.createdAt !== "string")
    return null;
  return compact<AskTurn>({ id: turn.id, question: turn.question, createdAt: turn.createdAt, ...answerFields(turn) });
}

function parseItem(value: unknown): AskItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Fields;
  if (typeof item.id !== "string" || typeof item.question !== "string" || typeof item.createdAt !== "string")
    return null;
  const turns = Array.isArray(item.turns)
    ? item.turns.map(parseTurn).filter((turn): turn is AskTurn => turn !== null)
    : undefined;
  return compact<AskItem>({
    id: item.id,
    question: item.question,
    createdAt: item.createdAt,
    ...answerFields(item),
    isSaved: typeof item.isSaved === "boolean" ? item.isSaved : undefined,
    sessionId: str(item.sessionId),
    messageId: str(item.messageId),
    turns,
    answerMode: mode(item.answerMode),
    visibility: item.visibility === "public" ? "public" : item.visibility === "private" ? "private" : undefined,
    publicId: str(item.publicId),
    publicStatus: PUBLIC_STATUSES.includes(item.publicStatus as AskPublicStatus)
      ? (item.publicStatus as AskPublicStatus)
      : undefined,
  });
}

/** SSR·저장소 없음의 스냅샷. useSyncExternalStore 가 같은 참조를 봐야 하므로 상수 하나를 돌려쓴다. */
export const EMPTY_ASK_ITEMS: readonly AskItem[] = [];

function readRaw(): string | null {
  try {
    return storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function parseItems(raw: string | null): AskItem[] {
  if (!raw) return EMPTY_ASK_ITEMS as AskItem[];
  try {
    const parsed: unknown = JSON.parse(raw);
    // 배열이 아니거나 항목 하나가 깨져도 화면이 죽지 않게 통과한 것만 남긴다.
    return Array.isArray(parsed)
      ? parsed
          .map(parseItem)
          .filter((item): item is AskItem => item !== null)
          .slice(0, ASK_MAX)
      : (EMPTY_ASK_ITEMS as AskItem[]);
  } catch {
    return EMPTY_ASK_ITEMS as AskItem[];
  }
}

// useSyncExternalStore 는 매 렌더마다 getSnapshot 을 부르고 참조가 바뀌면 다시 그린다 —
// 저장된 문자열이 그대로면 같은 배열을 돌려줘야 무한 렌더가 되지 않는다.
let snapshot: { raw: string | null; items: AskItem[] } = { raw: null, items: EMPTY_ASK_ITEMS as AskItem[] };

/** 최신순 질문 목록. 없거나 깨진 값이면 빈 배열이며 예외를 던지지 않는다. */
export function readAskItems(): AskItem[] {
  const raw = readRaw();
  if (raw !== snapshot.raw) snapshot = { raw, items: parseItems(raw) };
  return snapshot.items;
}

export function readAskItem(id: string): AskItem | null {
  return readAskItems().find((item) => item.id === id) ?? null;
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // SSR·구형 환경
  }
}

function writeAll(items: AskItem[]): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(items.slice(0, ASK_MAX)));
  } catch {
    // 저장 실패(용량 초과·차단)해도 화면의 값은 그대로 둔다
  }
  notify();
}

/** 새 질문을 맨 앞에 넣는다. 상한을 넘으면 가장 오래된 것부터 버린다. */
export function appendAskItem(item: AskItem): void {
  writeAll([item, ...readAskItems().filter((old) => old.id !== item.id)]);
}

/** 해당 질문만 부분 갱신한다. 없으면 아무 것도 하지 않는다. */
export function updateAskItem(id: string, patch: Partial<Omit<AskItem, "id">>): void {
  const items = readAskItems();
  if (!items.some((item) => item.id === id)) return;
  writeAll(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

/** 이어서 질문한 턴을 끝에 붙인다. */
export function appendAskTurn(id: string, turn: AskTurn): void {
  const item = readAskItem(id);
  if (!item) return;
  updateAskItem(id, { turns: [...(item.turns ?? []), turn] });
}

/** 턴 하나만 부분 갱신한다. */
export function updateAskTurn(id: string, turnId: string, patch: Partial<Omit<AskTurn, "id">>): void {
  const item = readAskItem(id);
  if (!item?.turns?.some((turn) => turn.id === turnId)) return;
  updateAskItem(id, { turns: item.turns.map((turn) => (turn.id === turnId ? { ...turn, ...patch } : turn)) });
}

/** 저장 토글. 바뀐 뒤의 값을 돌려준다(없으면 false). */
export function toggleAskSaved(id: string): boolean {
  const item = readAskItem(id);
  if (!item) return false;
  const next = !item.isSaved;
  updateAskItem(id, { isSaved: next });
  return next;
}

/** useSyncExternalStore 용 구독 — 같은 탭의 write 와 다른 탭의 storage 이벤트. */
export function subscribeAsk(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** crypto.randomUUID 가 없는 환경(구형 사파리·테스트)에서도 고유 id 를 만든다. */
export function newAskId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ask-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
