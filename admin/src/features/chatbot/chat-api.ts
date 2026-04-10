export interface ChatBot {
  chatbot_id: string;
  display_name: string;
  description: string;
}

export interface Source {
  volume: string;
  text: string;
  score: number;
  source: string;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  session_id: string;
  message_id: string;
}

export const chatAPI = {
  listBots: async (): Promise<ChatBot[]> => {
    const res = await fetch("/api/chatbots");
    if (!res.ok) throw new Error("챗봇 목록 조회 실패");
    return res.json();
  },

  sendMessage: async (
    query: string,
    chatbotId: string,
    sessionId?: string
  ): Promise<ChatResponse> => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        chatbot_id: chatbotId,
        session_id: sessionId,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `요청 실패 (${res.status})`);
    }
    return res.json();
  },
};
