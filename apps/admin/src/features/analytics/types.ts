// API DTO는 FastAPI OpenAPI에서 생성한다. 화면 정렬 상태만 로컬 타입이다.
export type {
  CitationItem,
  DailyCount,
  DailyModeCount,
  DashboardSummary,
  FeedbackDistribution,
  FeedbackItem,
  FeedbackSummary,
  NegativeFeedbackItem,
  QueryDetailResponse as QueryDetail,
  QueryListItem,
  QueryListResponse,
  QueryOccurrence,
  ReactionCount,
  SearchStats,
  SessionDetailResponse as SessionDetail,
  SessionMessageItem as SessionMessage,
  TopQuery,
} from "@truewords/api-client-ts/types";

export type QuerySortKey = "count_desc" | "count_asc" | "recent_desc" | "recent_asc";
