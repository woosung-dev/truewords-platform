// 감사 로그 백엔드 API 호출 모음.

import { fetchAPI } from "@/lib/api";
import type { AuditLog } from "./types";

export const auditLogAPI = {
  list: (limit: number, offset: number) =>
    fetchAPI<AuditLog[]>(`/admin/audit-logs?limit=${limit}&offset=${offset}`),
};
