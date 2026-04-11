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
  question: string;
  answer_snippet: string;
  feedback_type: string;
  comment: string | null;
  created_at: string;
}
