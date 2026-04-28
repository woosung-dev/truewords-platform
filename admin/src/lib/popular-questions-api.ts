// P1-C — 인기 질문 집계 API 래퍼.
//
// 백엔드 GET /api/chatbot/{chatbot_id}/popular-questions 를 호출해서
// 입력 화면 추천 질문 영역에 동적 인기 5개를 노출한다.
//
// period:
//   - "7d" (기본) | "30d" — 비인증 호출 가능
//   - "all" — admin 전용. 본 모듈에서는 사용하지 않는다 (admin endpoint 별도).

export type PopularPeriod = "7d" | "30d";

export interface PopularQuestion {
  question: string;
  count: number;
}

export interface FetchPopularOptions {
  period?: PopularPeriod;
  limit?: number;
  signal?: AbortSignal;
}

export async function fetchPopularQuestions(
  chatbotId: string,
  options: FetchPopularOptions = {},
): Promise<PopularQuestion[]> {
  const { period = "7d", limit = 5, signal } = options;
  const url = new URL(
    `/api/chatbot/${encodeURIComponent(chatbotId)}/popular-questions`,
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost",
  );
  url.searchParams.set("period", period);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.pathname + url.search, { signal });
  if (!res.ok) {
    throw new Error(`popular questions fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as PopularQuestion[];
  return Array.isArray(data) ? data : [];
}
