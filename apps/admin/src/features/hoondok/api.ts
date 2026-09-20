import { ApiError, fetchAPI } from "@/lib/api";
import type {
  DailyReading,
  DailyReadingAdminCreate,
  DailyReadingAdminUpdate,
  DailyReadingCandidateResponse,
} from "./types";

/** 후보 검색 조건. 길이·건수 기본값은 서버(API-HD-012)가 가진다 — 화면은 비우면 그대로 따른다. */
export interface CandidateQuery {
  q: string;
  sources?: string[];
  limit?: number;
}

// 편성 admin API (API-HD-006~008). 상태 변경의 CSRF 헤더는 fetchAPI 가 붙인다.
const BASE = "/admin/hoondok/daily-readings";

export const hoondokAPI = {
  /** 기간은 항상 명시한다 — 화면이 같은 범위로 "미편성" 행을 만들기 때문. */
  list: (from: string, to: string) => fetchAPI<DailyReading[]>(`${BASE}?${new URLSearchParams({ from, to })}`),
  get: (id: string) => fetchAPI<DailyReading>(`${BASE}/${id}`),
  create: (data: DailyReadingAdminCreate) =>
    fetchAPI<DailyReading>(BASE, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: DailyReadingAdminUpdate) =>
    fetchAPI<DailyReading>(`${BASE}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  /** API-HD-012 후보 검색(추출형). 본문은 코퍼스 원문 그대로 온다 — 화면이 가공하지 않는다. */
  candidates: ({ q, sources, limit }: CandidateQuery) => {
    const params = new URLSearchParams({ q });
    for (const s of sources ?? []) params.append("sources", s);
    if (limit !== undefined) params.set("limit", String(limit));
    return fetchAPI<DailyReadingCandidateResponse>(`${BASE}/candidates?${params}`);
  },
};

/** 등록·수정 실패 토스트 문구. 409 는 서버 문구("그 날짜에는 이미 편성이 있어요")를 그대로 쓴다. */
export function saveErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return err.message;
    if (err.status === 422) return "입력값을 확인해 주세요";
  }
  return fallback;
}
