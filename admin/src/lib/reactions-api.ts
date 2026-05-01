// P1-A — 답변 반응 (👍/👎/💾) API 래퍼.
// foundation 의 FeedbackButtons.onFeedback 핸들러에서 호출하면 된다.
//
// B2 보안: user_session_id 는 더 이상 클라이언트가 관리하지 않는다.
// 서버가 HttpOnly cookie `tw_anon_session` 으로 발급/유지한다. 따라서 이
// 모듈은 fetch 시 `credentials: "include"` 를 명시해 cookie 전송을 보장한다.

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

export async function toggleReaction(
  messageId: string,
  kind: ReactionKind,
): Promise<ReactionToggleResult> {
  const res = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/reaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // B2 — HttpOnly cookie 전송
    body: JSON.stringify({ kind }),
  });
  if (res.status === 429) {
    throw new Error("너무 자주 눌렀어요. 잠시 후 다시 시도해주세요.");
  }
  if (!res.ok) {
    throw new Error(`reaction toggle failed: ${res.status}`);
  }
  return (await res.json()) as ReactionToggleResult;
}

export async function getReactionAggregate(
  messageId: string,
): Promise<ReactionAggregate> {
  const res = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/reactions`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`reactions aggregate failed: ${res.status}`);
  }
  return (await res.json()) as ReactionAggregate;
}
