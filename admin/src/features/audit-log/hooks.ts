// 감사 로그 React Query 훅.

import { useQuery } from "@tanstack/react-query";
import { auditLogAPI } from "./api";

export function useAuditLogs(offset: number, pageSize: number) {
  return useQuery({
    queryKey: ["audit-logs", offset, pageSize],
    queryFn: () => auditLogAPI.list(pageSize, offset),
  });
}
