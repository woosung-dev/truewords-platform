const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// 모든 요청에 credentials: include (HttpOnly Cookie)
// 상태 변경 요청에 X-Requested-With 헤더 (CSRF 방어)
async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.method && ["POST", "PUT", "DELETE"].includes(options.method))
      ? { "X-Requested-With": "XMLHttpRequest" }
      : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("인증이 필요합니다");
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `요청 실패 (${res.status})`);
  }

  // 204 No Content or empty body
  const contentType = res.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return {} as T;
  }
  return res.json();
}

// Types
export interface SearchTier {
  sources: string[];
  min_results: number;
  score_threshold: number;
}

export interface SearchTiersConfig {
  tiers: SearchTier[];
  rerank_enabled?: boolean;
  dictionary_enabled?: boolean;
}

export interface ChatbotConfig {
  id: string;
  chatbot_id: string;
  display_name: string;
  description: string;
  system_prompt: string;
  persona_name: string;
  search_tiers: SearchTiersConfig;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminMe {
  user_id: string;
  role: string;
}

// Auth API
export const authAPI = {
  login: (email: string, password: string) =>
    fetchAPI<{ message: string }>("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () =>
    fetchAPI<{ message: string }>("/admin/auth/logout", {
      method: "POST",
    }),
  me: () => fetchAPI<AdminMe>("/admin/auth/me"),
};

// Chatbot Config API
export const chatbotAPI = {
  list: (limit = 20, offset = 0) =>
    fetchAPI<PaginatedResponse<ChatbotConfig>>(
      `/admin/chatbot-configs?limit=${limit}&offset=${offset}`
    ),
  get: (id: string) => fetchAPI<ChatbotConfig>(`/admin/chatbot-configs/${id}`),
  create: (data: {
    chatbot_id: string;
    display_name: string;
    description?: string;
    persona_name?: string;
    system_prompt?: string;
    search_tiers?: SearchTiersConfig;
    is_active?: boolean;
  }) =>
    fetchAPI<ChatbotConfig>("/admin/chatbot-configs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: {
      display_name?: string;
      description?: string;
      persona_name?: string;
      system_prompt?: string;
      search_tiers?: SearchTiersConfig;
      is_active?: boolean;
    }
  ) =>
    fetchAPI<ChatbotConfig>(`/admin/chatbot-configs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
