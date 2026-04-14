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
