export interface IngestionStatusSummary {
  total_files: number;
  completed_count: number;
  failed_count: number;
  total_chunks: number;
}

export interface InProgressEntry {
  total: number;
  next_chunk: number;
}

export interface IngestionStatus {
  completed: Record<string, number>;   // filename -> chunk count
  failed: Record<string, string>;      // filename -> error message
  in_progress: Record<string, InProgressEntry>; // filename -> {total, next_chunk}
  summary: IngestionStatusSummary;
}

export interface DataSourceCategory {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  is_searchable: boolean;
}

export interface CategoryDocumentStats {
  source: string;
  total_chunks: number;
  volumes: string[];
  volume_count: number;
}

export interface VolumeTagRequest {
  volume: string;
  source: string;
}

export interface VolumeTagResponse {
  volume: string;
  updated_sources: string[];
  updated_chunks: number;
}

export interface VolumeInfo {
  volume: string;
  sources: string[];
  chunk_count: number;
}

export interface VolumeTagsBulkRequest {
  volumes: string[];
  source: string;
}

export interface SkippedVolume {
  volume: string;
  reason: string;
}

export interface VolumeTagsBulkResponse {
  updated_volumes: string[];
  skipped_volumes: SkippedVolume[];
  total_chunks_modified: number;
}

export interface DuplicateCheckResponse {
  exists: boolean;
  volume_key: string;
  filename: string;
  sources: string[];
  chunk_count: number;
  status: string | null;
  last_uploaded_at: string | null;
  content_hash: string | null;  // 8자리 partial, 식별용. PR #99 — start_run 직후 저장하여 PARTIAL 도 보존.
}

// ADR-30 follow-up: upload 응답 — predicted_outcome으로 일괄 토스트 통계 집계.
export type PredictedOutcome = "new" | "merge" | "replace" | "skip";

export interface UploadResponse {
  message: string;
  filename: string;
  // Batch 모드 제거됨 (PR #95). 항상 standard.
  mode: "standard";
  on_duplicate: "merge" | "replace" | "skip";
  predicted_outcome: PredictedOutcome;
}

// Volume 영구 삭제 (Qdrant 청크 + IngestionJob row).
export interface VolumeDeleteRequest {
  volumes: string[];
}

export interface VolumeDeleteResponse {
  deleted_volumes: string[];
  total_chunks_deleted: number;
  skipped: SkippedVolume[];
}
