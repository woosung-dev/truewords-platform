import { createApiClient } from "@truewords/api-client-ts";
import type {
  LibraryResponse,
  MarkInput,
  MarkItem,
  MarksResponse,
  ReadingPositionItem,
  ReadingPositionsResponse,
  SectionsResponse,
  SeriesDetailResponse,
  WordSearchResponse,
  WordsResponse,
} from "@truewords/api-client-ts/types";
import { hoondokFetch } from "../observability/report";

const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });

/** 원문 한 페이지에 담기는 청크 수 (백엔드 `page_size` 고정값). chunk_index → page 환산에 쓴다. */
export const WORDS_PAGE_SIZE = 20;

/** 원문 요청의 위치 지정 — 셋 다 없으면 1페이지. `chunkId` 가 있으면 백엔드가 `section` 을 무시한다. */
export type WordsQuery = { chunkId?: string; section?: number };

export const libraryAPI = {
  list: () => request<LibraryResponse>("/hoondok/library", { cache: "no-store" }),
  search: (query: string, signal?: AbortSignal) =>
    request<WordSearchResponse>(`/hoondok/search?q=${encodeURIComponent(query)}`, { signal, cache: "no-store" }),
  words: (volume: string, page: number, query: WordsQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(page) });
    if (query.chunkId) params.set("chunk_id", query.chunkId);
    if (query.section !== undefined) params.set("section", String(query.section));
    return request<WordsResponse>(`/hoondok/words/${encodeURIComponent(volume)}?${params}`, {
      signal,
      cache: "no-store",
    });
  },
  /** API-HD-023 저작물 한 건의 권 목록. 허용 0건이면 404 다. */
  series: (series: string, signal?: AbortSignal) =>
    request<SeriesDetailResponse>(`/hoondok/library/${encodeURIComponent(series)}`, { signal, cache: "no-store" }),
  /** API-HD-024 장 목차. 0건이면 빈 배열이고 화면은 "원문 구간 N" 으로 폴백한다. */
  sections: (volume: string, signal?: AbortSignal) =>
    request<SectionsResponse>(`/hoondok/sections/${encodeURIComponent(volume)}`, { signal, cache: "no-store" }),
  // --- 아래는 모두 로그인(`hoondok_token`) 필요. 쓰기는 SDK 전송층이 X-Requested-With 를 붙인다.
  readingPositions: (limit = 5) =>
    request<ReadingPositionsResponse>(`/hoondok/me/reading-positions?limit=${limit}`, { cache: "no-store" }),
  saveReadingPosition: (volume: string, chunkIndex: number) =>
    request<ReadingPositionItem>(`/hoondok/me/reading-position/${encodeURIComponent(volume)}`, {
      method: "PUT",
      body: JSON.stringify({ chunk_index: chunkIndex }),
    }),
  marks: (query: { volume?: string; kind?: MarkItem["kind"] } = {}) => {
    const params = new URLSearchParams();
    if (query.volume) params.set("volume", query.volume);
    if (query.kind) params.set("kind", query.kind);
    const suffix = params.size > 0 ? `?${params}` : "";
    return request<MarksResponse>(`/hoondok/me/marks${suffix}`, { cache: "no-store" });
  },
  saveMark: (chunkId: string, input: MarkInput) =>
    request<MarkItem>(`/hoondok/me/marks/${encodeURIComponent(chunkId)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteMark: (chunkId: string, kind: MarkItem["kind"]) =>
    request<void>(`/hoondok/me/marks/${encodeURIComponent(chunkId)}?kind=${kind}`, { method: "DELETE" }),
};

export function wordsHref(volume: string, chunkId?: string | null): string {
  return `/hoondok/words/${encodeURIComponent(volume)}${chunkId ? `?chunk_id=${encodeURIComponent(chunkId)}` : ""}`;
}
export function wordsPageHref(volume: string, page: number): string {
  return `${wordsHref(volume)}?page=${page}`;
}
export function wordsSectionHref(volume: string, position: number): string {
  return `${wordsHref(volume)}?section=${position}`;
}
export function seriesHref(series: string): string {
  return `/hoondok/library/${encodeURIComponent(series)}`;
}
/** 청크 번호가 들어 있는 페이지. 서버 이어 읽기 값(chunk_index)을 원문 링크로 바꾼다. */
export function pageOfChunkIndex(chunkIndex: number): number {
  return Math.floor(chunkIndex / WORDS_PAGE_SIZE) + 1;
}
/** 사람에게 보이는 단락 번호(1부터). 저장·API 키는 0부터인 chunk_index 그대로다(PLAN-HD-008). */
export function verseNumber(chunkIndex: number): number {
  return chunkIndex + 1;
}
