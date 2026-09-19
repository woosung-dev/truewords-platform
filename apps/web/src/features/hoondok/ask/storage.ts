// SCR-PWA-005·006 AI 질문 기록 — 기기 전용 저장소 (PLAN-HD-002 W2, REQ-PWA-015).
// 질문·답·근거는 서버로 보내지 않고 이 브라우저 localStorage 한 키(JSON 배열)에만 둔다.
// 서버에는 시연 챗과 같은 `/chat/stream` 요청 기록만 남고(무기억 = session_id 미전송), 답을 따로 저장하지 않는다.
// 저장소는 없거나 던질 수 있으므로(사생활 모드·차단) 모든 접근을 try/catch 로 감싼다 — note/storage.ts 와 같은 규칙.

import type { Source } from "@truewords/api-client-ts/types";

const KEY = "hoondok:ask:items";
// note·install 의 이벤트와 분리한다 — 질문 기록 변경이 다른 화면을 다시 그리지 않게.
const CHANGE_EVENT = "hoondok:ask-change";

/** 보관 상한. 넘으면 오래된 것부터 버린다(배열 앞이 최신). */
export const ASK_MAX = 50;

/** 답변 상태. pending 은 아직 스트리밍 전이라 상세 화면이 마운트될 때 요청을 시작한다. */
export type AskStatus = "pending" | "answered" | "no-sources" | "error";

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
  /** 저장 토글. 기본 false 이며 기록 화면의 "저장한 답" 세그먼트가 센다. */
  isSaved?: boolean;
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isItem(value: unknown): value is AskItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.question === "string" && typeof item.createdAt === "string";
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
    return Array.isArray(parsed) ? parsed.filter(isItem).slice(0, ASK_MAX) : (EMPTY_ASK_ITEMS as AskItem[]);
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

/** 저장 토글. 바뀐 뒤의 값을 돌려준다(없으면 false). */
export function toggleAskSaved(id: string): boolean {
  const item = readAskItem(id);
  if (!item) return false;
  const next = !item.isSaved;
  updateAskItem(id, { isSaved: next });
  return next;
}

export function removeAskItem(id: string): void {
  writeAll(readAskItems().filter((item) => item.id !== id));
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
