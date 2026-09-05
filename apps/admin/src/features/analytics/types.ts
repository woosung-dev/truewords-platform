// API DTO는 FastAPI OpenAPI에서 생성한다. 화면 정렬 상태만 로컬 타입이다.
export type {
  DashboardSummary, DailyCount, DailyModeCount, SearchStats, TopQuery,
  FeedbackDistribution, FeedbackSummary, NegativeFeedbackItem, ReactionCount,
  SessionMessageItem as SessionMessage, SessionDetailResponse as SessionDetail,
  CitationItem, FeedbackItem, QueryOccurrence, QueryDetailResponse as QueryDetail,
  QueryListItem, QueryListResponse,
} from "@truewords/api-client-ts/types";

export type QuerySortKey = "count_desc" | "count_asc" | "recent_desc" | "recent_asc";
