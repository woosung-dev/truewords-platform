// chatbot 도메인 React Query 키 팩토리.

export const chatbotKeys = {
  all: ["chatbot"] as const,

  list: (page: number) => [...chatbotKeys.all, "list", page] as const,
  detail: (id: string) => [...chatbotKeys.all, "detail", id] as const,
};
