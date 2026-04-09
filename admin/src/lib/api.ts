// Next.js rewrites가 /admin/* → 백엔드로 프록시 (same-origin, CORS 불필요)
async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.method && ["POST", "PUT", "DELETE"].includes(options.method))
      ? { "X-Requested-With": "XMLHttpRequest" }
      : {}),
  };

  const res = await fetch(path, {
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

  // 204 No Content (body 없음)
  if (res.status === 204) {
    return {} as T;
  }

  const contentType = res.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return {} as T;
  }
  return (await res.json()) as T;
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

// Data (RAG Ingestion) API
export interface IngestionStatusSummary {
  total_files: number;
  completed_count: number;
  failed_count: number;
  total_chunks: number;
}

export interface InProgressEntry {
  total: number;
  next_chunk: number;
}

export interface IngestionStatus {
  completed: Record<string, number>;   // filename -> chunk count
  failed: Record<string, string>;      // filename -> error message
  in_progress: Record<string, InProgressEntry>; // filename -> {total, next_chunk}
  summary: IngestionStatusSummary;
}

export const dataAPI = {
  uploadFile: async (file: File, source: string) => {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("source", source)

    // FormData requests don't use "Content-Type: application/json"
    // Fetch automatically applies the correct multipart/form-data boundary
    const headers = {
      "X-Requested-With": "XMLHttpRequest",
    }

    const res = await fetch(`/admin/data-sources/upload`, {
      method: "POST",
      credentials: "include",
      headers,
      body: formData,
    })

    if (res.status === 401) {
      if (typeof window !== "undefined") {
        window.location.href = "/login"
      }
      throw new Error("인증이 필요합니다")
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `요청 실패 (${res.status})`)
    }

    return res.json()
  },

  getStatus: () => fetchAPI<IngestionStatus>("/admin/data-sources/status"),
};

// Data Source Category API
export interface DataSourceCategory {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  is_searchable: boolean;
}

export interface CategoryDocumentStats {
  source: string;
  total_chunks: number;
  volumes: string[];
  volume_count: number;
}

export interface VolumeTagRequest {
  volume: string;
  source: string;
}

export interface VolumeTagResponse {
  volume: string;
  updated_sources: string[];
  updated_chunks: number;
}

export const dataSourceCategoryAPI = {
  list: () =>
    fetchAPI<DataSourceCategory[]>("/admin/data-source-categories"),
  create: (data: Omit<DataSourceCategory, "id">) =>
    fetchAPI<DataSourceCategory>("/admin/data-source-categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<DataSourceCategory>) =>
    fetchAPI<DataSourceCategory>(`/admin/data-source-categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/admin/data-source-categories/${id}`, {
      method: "DELETE",
    }),
  getCategoryStats: () =>
    fetchAPI<CategoryDocumentStats[]>("/admin/data-sources/category-stats"),
  addVolumeTag: (data: VolumeTagRequest) =>
    fetchAPI<VolumeTagResponse>("/admin/data-sources/volume-tags", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  removeVolumeTag: (data: VolumeTagRequest) =>
    fetchAPI<VolumeTagResponse>("/admin/data-sources/volume-tags", {
      method: "DELETE",
      body: JSON.stringify(data),
    }),
};
