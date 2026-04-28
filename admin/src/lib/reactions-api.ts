// P1-A — 답변 반응 (👍/👎/💾) API 래퍼.
// foundation 의 FeedbackButtons.onFeedback 핸들러에서 호출하면 된다.

const SESSION_KEY = "tw_user_session_id";

function makeRandomId(): string {
  // crypto.randomUUID 가 modern 브라우저/Node18+ 에서 표준. SSR fallback 도 처리.
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  // weak fallback — 실 사용 케이스에서는 거의 도달하지 않음.
  return `tw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type ReactionKind = "thumbs_up" | "thumbs_down" | "save";

export interface ReactionToggleResult {
  action: "added" | "removed";
  reaction: {
    id: string;
    message_id: string;
    user_session_id: string;
    kind: ReactionKind;
    created_at: string;
  } | null;
}

export interface ReactionAggregate {
  message_id: string;
  thumbs_up: number;
  thumbs_down: number;
  save: number;
}

/**
 * 비로그인 사용자도 토글 가능 — localStorage 기반 user_session_id 발급.
 * 로그인 시 jwt sub 또는 user_id 로 마이그레이션 가능하도록 키만 분리.
 */
export function getOrCreateUserSessionId(): string {
  if (typeof window === "undefined") return "ssr-fallback";
  let sid = window.localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = makeRandomId();
    window.localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

export async function toggleReaction(
  messageId: string,
  kind: ReactionKind,
): Promise<ReactionToggleResult> {
  const userSessionId = getOrCreateUserSessionId();
  const res = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/reaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, user_session_id: userSessionId }),
  });
  if (!res.ok) {
    throw new Error(`reaction toggle failed: ${res.status}`);
  }
  return (await res.json()) as ReactionToggleResult;
}

export async function getReactionAggregate(
  messageId: string,
): Promise<ReactionAggregate> {
  const res = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/reactions`);
  if (!res.ok) {
    throw new Error(`reactions aggregate failed: ${res.status}`);
  }
  return (await res.json()) as ReactionAggregate;
}
