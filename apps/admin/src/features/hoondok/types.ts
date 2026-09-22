import type { DailyReadingAdminResponse } from "@truewords/api-client-ts/types";

// 편성 화면 모델 = 생성 SDK 타입 (API-HD-006~008). 직접 정의하지 않는다.
export type {
  BulkRightsInput,
  BulkRightsResponse,
  ContentRightInput,
  ContentRightResponse as ContentRight,
  DailyReadingAdminCreate,
  DailyReadingAdminResponse as DailyReading,
  DailyReadingAdminUpdate,
  DailyReadingCandidate,
  DailyReadingCandidateResponse,
  SeriesSummaryItem,
} from "@truewords/api-client-ts/types";

export type AuthorityGrade = DailyReadingAdminResponse["authority_grade"];
export type ReviewStatus = DailyReadingAdminResponse["review_status"];
