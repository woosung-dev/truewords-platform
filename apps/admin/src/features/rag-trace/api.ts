import { fetchAPI } from "@/lib/api";
import type { RagTraceRequest, RagTraceResponse } from "./types";

export const ragTraceAPI = {
  // 저장하지 않는 replay — 최대 약 25초 걸리는 동기 요청이다. CSRF 헤더는 SDK가 붙인다.
  run: (data: RagTraceRequest) =>
    fetchAPI<RagTraceResponse>("/admin/rag-trace", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
