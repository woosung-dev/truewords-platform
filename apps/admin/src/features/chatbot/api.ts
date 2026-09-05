import { fetchAPI } from "@/lib/api";
import type { ChatbotConfig, PaginatedChatbotResponse } from "./types";
import type { ChatbotConfigCreate, ChatbotConfigUpdate } from "@truewords/api-client-ts/types";

export const chatbotAPI = {
  list: (limit = 20, offset = 0) =>
    fetchAPI<PaginatedChatbotResponse>(
      `/admin/chatbot-configs?limit=${limit}&offset=${offset}`
    ),
  get: (id: string) => fetchAPI<ChatbotConfig>(`/admin/chatbot-configs/${id}`),
  create: (data: ChatbotConfigCreate) =>
    fetchAPI<ChatbotConfig>("/admin/chatbot-configs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: ChatbotConfigUpdate
  ) =>
    fetchAPI<ChatbotConfig>(`/admin/chatbot-configs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
