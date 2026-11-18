import type { SummaryDetail, SummaryEvidenceSource, SummaryListItem } from "@truewords/api-client-ts/types";
import { hoondokRequest as request } from "../api-client";

export const summariesAPI = {
  list: (signal?: AbortSignal, volume?: string) => request<SummaryListItem[]>(`/hoondok/ai-summaries${volume ? `?volume=${encodeURIComponent(volume)}` : ""}`, { signal, cache: "no-store" }),
  detail: (id: string, signal?: AbortSignal) => request<SummaryDetail>(`/hoondok/ai-summaries/${encodeURIComponent(id)}`, { signal, cache: "no-store" }),
  /** 근거(요약 근거 목록 순번, 0부터) 한 건의 원문 미리보기 */
  evidence: (id: string, index: number, signal?: AbortSignal) => request<SummaryEvidenceSource>(`/hoondok/ai-summaries/${encodeURIComponent(id)}/evidence/${index}`, { signal, cache: "no-store" }),
};
