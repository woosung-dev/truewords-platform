import type { ContentRightInput, ContentRightResponse } from "@truewords/api-client-ts/types";
import { fetchAPI } from "@/lib/api";

const BASE = "/admin/hoondok/content-rights";
export const rightsAPI = {
  list: () => fetchAPI<ContentRightResponse[]>(BASE),
  create: (data: ContentRightInput) =>
    fetchAPI<ContentRightResponse>(BASE, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: ContentRightInput) =>
    fetchAPI<ContentRightResponse>(`${BASE}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
};
