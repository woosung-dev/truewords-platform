import type {
  SummaryInput,
  SummaryUpdate,
  SummaryAdminResponse,
  SummaryActionInput,
  SummaryMediaResponse,
} from "@truewords/api-client-ts/types";
import { fetchAPI } from "@/lib/api";

export type { SummaryInput, SummaryAdminResponse };
const BASE = "/admin/hoondok/ai-summaries";
export const summariesAPI = {
  list: () => fetchAPI<SummaryAdminResponse[]>(BASE),
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
