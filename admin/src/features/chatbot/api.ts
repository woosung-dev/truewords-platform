import { fetchAPI } from "@/lib/api";
import type { ChatbotConfig, PaginatedResponse, SearchTiersConfig } from "./types";

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
      collection_main?: string;
      is_active?: boolean;
    }
  ) =>
    fetchAPI<ChatbotConfig>(`/admin/chatbot-configs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
