// analytics 도메인 React Query 키 팩토리.

export const analyticsKeys = {
  all: ["analytics"] as const,

  searchStats: (days: number) => [...analyticsKeys.all, "search-stats", days] as const,
  dailyTrend: (days: number) => [...analyticsKeys.all, "daily-trend", days] as const,
  topQueries: (days: number, limit: number) =>
    [...analyticsKeys.all, "top-queries", days, limit] as const,
  dailyModes: (days: number) => [...analyticsKeys.all, "daily-modes", days] as const,
  queries: (
    q: string,
    days: number,
    sort: string,
    page: number,
    size: number,
  ) => [...analyticsKeys.all, "queries", q, days, sort, page, size] as const,
  queryDetails: (queryText: string, days: number) =>
    [...analyticsKeys.all, "query-details", queryText, days] as const,
  sessionDetail: (sessionId: string | null) =>
    [...analyticsKeys.all, "session-detail", sessionId] as const,
};
