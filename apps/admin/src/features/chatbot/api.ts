import type { ChatbotConfigCreate, ChatbotConfigUpdate } from "@truewords/api-client-ts/types";
import { fetchAPI } from "@/lib/api";
import type { ChatbotConfig, PaginatedChatbotResponse } from "./types";

// 목록 쿼리 키. limit·offset 이 응답을 정하므로 키에 포함한다(접두 ["chatbots"] 는 무효화용으로 유지).
export const chatbotListKey = (limit: number, offset: number) => ["chatbots", "list", limit, offset] as const;

export const chatbotAPI = {
  list: (limit = 20, offset = 0) =>
    fetchAPI<PaginatedChatbotResponse>(`/admin/chatbot-configs?limit=${limit}&offset=${offset}`),
  get: (id: string) => fetchAPI<ChatbotConfig>(`/admin/chatbot-configs/${id}`),
  create: (data: ChatbotConfigCreate) =>
    fetchAPI<ChatbotConfig>("/admin/chatbot-configs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: ChatbotConfigUpdate) =>
    fetchAPI<ChatbotConfig>(`/admin/chatbot-configs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
