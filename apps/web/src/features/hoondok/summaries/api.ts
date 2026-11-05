import { createApiClient } from "@truewords/api-client-ts";
import type { SummaryDetail, SummaryListItem } from "@truewords/api-client-ts/types";
import { hoondokFetch } from "../observability/report";

const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });
export const summariesAPI = {
  list: (signal?: AbortSignal, volume?: string) => request<SummaryListItem[]>(`/hoondok/ai-summaries${volume ? `?volume=${encodeURIComponent(volume)}` : ""}`, { signal, cache: "no-store" }),
  detail: (id: string, signal?: AbortSignal) => request<SummaryDetail>(`/hoondok/ai-summaries/${encodeURIComponent(id)}`, { signal, cache: "no-store" }),
};
