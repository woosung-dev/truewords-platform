import type {
  BulkRightsInput,
  BulkRightsResponse,
  ContentRightInput,
  ContentRightResponse,
  SeriesSummaryResponse,
} from "@truewords/api-client-ts/types";
import { fetchAPI } from "@/lib/api";

const BASE = "/admin/hoondok/content-rights";

// 권리 원장 admin API (API-HD-020~022 · 027 · 028). 상태 변경의 CSRF 헤더는 fetchAPI 가 붙인다.
export const rightsAPI = {
  list: () => fetchAPI<ContentRightResponse[]>(BASE),
  create: (data: ContentRightInput) =>
    fetchAPI<ContentRightResponse>(BASE, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: ContentRightInput) =>
    fetchAPI<ContentRightResponse>(`${BASE}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  /** API-HD-028 시리즈별 등록·공개·대기·철회 집계. 원장이 비어 있으면 `items` 가 빈 배열이다. */
  seriesSummary: () => fetchAPI<SeriesSummaryResponse>(`${BASE}/series`),
  /** API-HD-027 시리즈 일괄 갱신. `authority_grade` 는 보낸 경우에만 바뀐다(미지정 = 기존 보존). */
  bulk: (data: BulkRightsInput) =>
    fetchAPI<BulkRightsResponse>(`${BASE}/bulk`, { method: "POST", body: JSON.stringify(data) }),
};
