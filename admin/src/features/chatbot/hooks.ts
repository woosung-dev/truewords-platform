// 챗봇 도메인 React Query 훅.

import { useQuery } from "@tanstack/react-query";
import { chatbotAPI } from "./api";
import { chatbotKeys } from "./keys";

const PAGE_SIZE = 20;

export function useChatbotsPage(page: number, pageSize: number = PAGE_SIZE) {
  return useQuery({
    queryKey: chatbotKeys.list(page),
    queryFn: () => chatbotAPI.list(pageSize, page * pageSize),
  });
}

export function useChatbotDetail(id: string) {
  return useQuery({
    queryKey: chatbotKeys.detail(id),
    queryFn: () => chatbotAPI.get(id),
    enabled: !!id,
  });
}
