export interface DashboardSummary {
  today_questions: number;
  week_questions: number;
  total_qdrant_points: number;
  feedback_helpful: number;
  feedback_negative: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface SearchStats {
  total_searches: number;
  rewrite_rate: number;
  zero_result_rate: number;
  avg_latency_ms: number;
  fallback_none: number;
  fallback_relaxed: number;
  fallback_suggestions: number;
}

export interface TopQuery {
  query_text: string;
  count: number;
}

export interface FeedbackDistribution {
  feedback_type: string;
  count: number;
}

export interface FeedbackSummary {
  distribution: FeedbackDistribution[];
}

export interface NegativeFeedbackItem {
  id: string;
  session_id: string;
  chatbot_name: string | null;
  question: string;
  answer_snippet: string;
  feedback_type: string;
  comment: string | null;
  created_at: string;
}

export interface ReactionCount {
  kind: string;
  count: number;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  resolved_answer_mode: string | null;
  persona_overridden: boolean | null;
  reactions: ReactionCount[];
  feedback: FeedbackItem | null;
  citations: CitationItem[];
}

export interface SessionDetail {
  session_id: string;
  chatbot_id: string | null;
  chatbot_name: string | null;
  started_at: string;
  ended_at: string | null;
  messages: SessionMessage[];
}

export interface CitationItem {
  source: string;
  volume: number;
  chapter: string | null;
  text_snippet: string;
  relevance_score: number;
  rank_position: number;
}

export interface FeedbackItem {
  feedback_type: string;
  comment: string | null;
  created_at: string;
}

export interface QueryOccurrence {
  search_event_id: string;
  user_message_id: string | null;
  assistant_message_id: string | null;
  session_id: string;
  chatbot_id: string | null;
  chatbot_name: string | null;
  asked_at: string;
  rewritten_query: string | null;
  search_tier: number;
  total_results: number;
  latency_ms: number;
  applied_filters: Record<string, unknown>;
  answer_text: string | null;
  citations: CitationItem[];
  feedback: FeedbackItem | null;
}

export interface QueryDetail {
  query_text: string;
  total_count: number;
  returned_count: number;
  days: number;
  occurrences: QueryOccurrence[];
}

export type QuerySortKey =
  | "count_desc"
  | "count_asc"
  | "recent_desc"
  | "recent_asc";

export interface QueryListItem {
  query_text: string;
  count: number;
  latest_at: string;
  negative_feedback_count: number;
}

export interface QueryListResponse {
  items: QueryListItem[];
  total: number;
  page: number;
  size: number;
  days: number;
}
