import { fetchAPI } from "@/lib/api";
import type {
  DashboardSummary,
  DailyCount,
  SearchStats,
  TopQuery,
  FeedbackSummary,
  NegativeFeedbackItem,
  QueryDetail,
} from "./types";

export const analyticsAPI = {
  getDashboardSummary: () =>
    fetchAPI<DashboardSummary>("/admin/analytics/dashboard-summary"),

  getDailyTrend: (days = 30) =>
    fetchAPI<DailyCount[]>(`/admin/analytics/search/daily-trend?days=${days}`),

  getSearchStats: (days = 30) =>
    fetchAPI<SearchStats>(`/admin/analytics/search/stats?days=${days}`),

  getTopQueries: (days = 30, limit = 10) =>
    fetchAPI<TopQuery[]>(
      `/admin/analytics/search/top-queries?days=${days}&limit=${limit}`
    ),

  getFeedbackSummary: (days = 30) =>
    fetchAPI<FeedbackSummary>(
      `/admin/analytics/feedback/summary?days=${days}`
    ),

  getNegativeFeedback: (limit = 20, offset = 0) =>
    fetchAPI<NegativeFeedbackItem[]>(
      `/admin/analytics/feedback/negative?limit=${limit}&offset=${offset}`
    ),

  getQueryDetails: (queryText: string, days = 30, limit = 50) =>
    fetchAPI<QueryDetail>(
      `/admin/analytics/search/query-details?query_text=${encodeURIComponent(
        queryText
      )}&days=${days}&limit=${limit}`
    ),
};
