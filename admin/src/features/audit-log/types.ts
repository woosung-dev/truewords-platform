// 감사 로그 도메인 타입 정의.

export interface AuditLog {
  id: string;
  admin_user_id: string;
  action: string;
  target_table: string;
  target_id: string;
  changes: Record<string, unknown>;
  created_at: string;
}
