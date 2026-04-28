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
  collection_main: string;
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
