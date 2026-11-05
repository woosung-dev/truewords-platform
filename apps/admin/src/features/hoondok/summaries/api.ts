import type {
  SummaryInput,
  SummaryUpdate,
  SummaryAdminResponse,
  SummaryActionInput,
  SummaryMediaResponse,
  SummaryTocItem,
} from "@truewords/api-client-ts/types";
import { fetchAPI } from "@/lib/api";

export type { SummaryInput, SummaryAdminResponse, SummaryTocItem };
export type SummaryWork = "cheonseong" | "pyeonghwa";
const BASE = "/admin/hoondok/ai-summaries";
export const summariesAPI = {
  // 경전 목차 발행 관리 목록(천성경 199절·평화경 182 연설문·장). 거르기는 화면에서 한다(편 이름·개수를 함께 보여야 해서).
  toc: (work: SummaryWork) => fetchAPI<SummaryTocItem[]>(`${BASE}/toc?work=${work}`),
  get: (id: string) => fetchAPI<SummaryAdminResponse>(`${BASE}/${id}`),
  create: (data: SummaryInput) =>
    fetchAPI<SummaryAdminResponse>(BASE, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: SummaryUpdate) =>
    fetchAPI<SummaryAdminResponse>(`${BASE}/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  action: (id: string, data: SummaryActionInput) =>
    fetchAPI<SummaryAdminResponse>(`${BASE}/${id}/actions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  upload: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetchAPI<SummaryMediaResponse>(`${BASE}/${id}/media`, {
      method: "POST",
      body: form,
    });
  },
};
