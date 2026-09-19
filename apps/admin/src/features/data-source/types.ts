export type {
  CategoryDocumentStats,
  DataSourceCategoryResponse as DataSourceCategory,
  DuplicateCheckResponse,
  IngestionJobInfo,
  IngestionStatusResponse as IngestionStatus,
  IngestionStatusSummary,
  InProgressEntry,
  SkippedVolume,
  UpdateDisplayNameRequest,
  UploadResponse,
  VolumeDeleteRequest,
  VolumeDeleteResponse,
  VolumeInfo,
  VolumeTagRequest,
  VolumeTagResponse,
  VolumeTagsBulkRequest,
  VolumeTagsBulkResponse,
} from "@truewords/api-client-ts/types";

// API는 확장 가능한 string이다. 이 타입은 현재 화면의 집계 버킷만 정의한다.
export type PredictedOutcome = "new" | "merge" | "replace" | "skip";

export function isPredictedOutcome(value: string): value is PredictedOutcome {
  return value === "new" || value === "merge" || value === "replace" || value === "skip";
}
