import { createApiClient } from "@truewords/api-client-ts";
import type { LibraryResponse, WordSearchResponse, WordsResponse } from "@truewords/api-client-ts/types";
import { hoondokFetch } from "../observability/report";

const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });
export const libraryAPI = {
  list: () => request<LibraryResponse>("/hoondok/library", { cache: "no-store" }),
  search: (query: string, signal?: AbortSignal) =>
    request<WordSearchResponse>(`/hoondok/search?q=${encodeURIComponent(query)}`, { signal, cache: "no-store" }),
  words: (volume: string, page: number, chunkId?: string, signal?: AbortSignal) =>
    request<WordsResponse>(
      `/hoondok/words/${encodeURIComponent(volume)}?page=${page}${chunkId ? `&chunk_id=${encodeURIComponent(chunkId)}` : ""}`,
      { signal, cache: "no-store" },
    ),
};

export function wordsHref(volume: string, chunkId?: string | null): string {
  return `/hoondok/words/${encodeURIComponent(volume)}${chunkId ? `?chunk_id=${encodeURIComponent(chunkId)}` : ""}`;
}
