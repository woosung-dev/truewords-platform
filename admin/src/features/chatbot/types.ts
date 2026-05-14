export type { PaginatedResponse } from "@/types";

export interface SearchTier {
  sources: string[];
  min_results: number;
  score_threshold: number;
}

export interface WeightedSource {
  source: string;
  weight: number;
  score_threshold: number;
}

export interface SearchTiersConfig {
  search_mode?: "cascading" | "weighted";
  tiers: SearchTier[];
  weighted_sources?: WeightedSource[];
  rerank_enabled?: boolean;
  dictionary_enabled?: boolean;
  query_rewrite_enabled?: boolean;
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
  // 봇별 SSE 스트리밍 응답 활성화. default true. false 면 chat 화면이 비스트림 단일 응답으로 분기.
  streaming_enabled: boolean;
  created_at: string;
  updated_at: string;
}

