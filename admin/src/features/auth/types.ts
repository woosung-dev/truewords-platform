export interface AdminMe {
  user_id: string;
  role: string;
}

export interface AdminUserResponse {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}
