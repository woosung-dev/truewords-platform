// P1-H — 인용 카드 단위 사용자 노트 API 래퍼.
// foundation 의 CitationCard.note prop 을 자동저장 textarea 로 감쌀 때 사용한다.
//
// 보안: user_session_id 는 클라이언트가 다루지 않는다. 서버가 HttpOnly cookie
// `tw_anon_session` 으로 발급/유지한다 (B2 reactions 와 동일 cookie 공유).
// 따라서 fetch 시 `credentials: "include"` 를 명시한다.

export interface CitationNote {
  id: string;
  message_id: string;
  chunk_id: string;
  body: string;
  updated_at: string;
}

/** 노트 길이 제한 — 백엔드 NOTE_BODY_MAX_LENGTH 와 동일. */
export const NOTE_BODY_MAX_LENGTH = 4000;

export async function loadNote(
  messageId: string,
  chunkId: string,
): Promise<CitationNote | null> {
  const url =
    `/api/chat/messages/${encodeURIComponent(messageId)}/citation-note` +
    `?chunk_id=${encodeURIComponent(chunkId)}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`note load failed: ${res.status}`);
  }
  const data = (await res.json()) as CitationNote | null;
  return data;
}

export async function saveNote(
  messageId: string,
  chunkId: string,
  body: string,
): Promise<CitationNote> {
  const res = await fetch(
    `/api/chat/messages/${encodeURIComponent(messageId)}/citation-note`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ chunk_id: chunkId, body }),
    },
  );
  if (res.status === 429) {
    throw new Error("너무 자주 저장했어요. 잠시 후 다시 시도해주세요.");
  }
  if (res.status === 422) {
    throw new Error("입력 내용을 확인해주세요.");
  }
  if (!res.ok) {
    throw new Error(`note save failed: ${res.status}`);
  }
  return (await res.json()) as CitationNote;
}
