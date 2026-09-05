import { fetchAPI } from "@/lib/api";
import type { DataSourceCategoryCreate, DataSourceCategoryUpdate } from "@truewords/api-client-ts/types";
import type {
  DataSourceCategory,
  DuplicateCheckResponse,
  IngestionJobInfo,
  IngestionStatus,
  CategoryDocumentStats,
  UpdateDisplayNameRequest,
  UploadResponse,
  VolumeDeleteRequest,
  VolumeDeleteResponse,
  VolumeTagRequest,
  VolumeTagResponse,
  VolumeInfo,
  VolumeTagsBulkRequest,
  VolumeTagsBulkResponse,
} from "./types";

// 현재 화면에서 사용자가 선택할 수 있는 정책이다. 응답 DTO의 string을 좁히지 않는다.
export type OnDuplicateMode = "merge" | "replace" | "skip";

export const dataAPI = {
  uploadFile: async (
    file: File,
    source: string,
    // Batch API 제거됨 (PR #95). mode 인자는 백엔드 호환을 위해 standard 고정.
    mode: "standard" = "standard",
    onDuplicate: OnDuplicateMode = "merge",
  ): Promise<UploadResponse> => {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("source", source)
    formData.append("mode", mode)
    formData.append("on_duplicate", onDuplicate)

    // 공통 transport가 CSRF/쿠키를 보존하고 multipart boundary는 fetch에 맡긴다.
    return fetchAPI<UploadResponse>("/admin/data-sources/upload", {
      method: "POST",
      body: formData,
    })
  },

  getStatus: () => fetchAPI<IngestionStatus>("/admin/data-sources/status"),

  // 파일별 IngestionJob 목록. display_name 인라인 편집 화면용.
  getJobs: () => fetchAPI<IngestionJobInfo[]>("/admin/data-sources/jobs"),

  // 파일별 사용자 친화적 표시명 갱신. chat 응답의 출처 카드/원문 모달에서 우선 노출.
  updateDisplayName: (data: UpdateDisplayNameRequest) =>
    fetchAPI<IngestionJobInfo>("/admin/data-sources/display-name", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  checkDuplicate: (filename: string) =>
    fetchAPI<DuplicateCheckResponse>(
      `/admin/data-sources/check-duplicate?filename=${encodeURIComponent(filename)}`
    ),
  // ADR-30 Phase 3 — volume(파일) 영구 삭제 (Qdrant + IngestionJob)
  deleteVolume: (volume: string) =>
    fetchAPI<VolumeDeleteResponse>(
      `/admin/data-sources/volumes/${encodeURIComponent(volume)}`,
      { method: "DELETE" },
    ),
  deleteVolumesBulk: (data: VolumeDeleteRequest) =>
    fetchAPI<VolumeDeleteResponse>("/admin/data-sources/volumes/delete-bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

export const dataSourceCategoryAPI = {
  list: () =>
    fetchAPI<DataSourceCategory[]>("/admin/data-source-categories"),
  create: (data: DataSourceCategoryCreate) =>
    fetchAPI<DataSourceCategory>("/admin/data-source-categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: DataSourceCategoryUpdate) =>
    fetchAPI<DataSourceCategory>(`/admin/data-source-categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/admin/data-source-categories/${id}`, {
      method: "DELETE",
    }),
  getCategoryStats: () =>
    fetchAPI<CategoryDocumentStats[]>("/admin/data-sources/category-stats"),
  addVolumeTag: (data: VolumeTagRequest) =>
    fetchAPI<VolumeTagResponse>("/admin/data-sources/volume-tags", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  removeVolumeTag: (data: VolumeTagRequest) =>
    fetchAPI<VolumeTagResponse>("/admin/data-sources/volume-tags", {
      method: "DELETE",
      body: JSON.stringify(data),
    }),
  getAllVolumes: () =>
    fetchAPI<VolumeInfo[]>("/admin/data-sources/volumes"),
  addVolumeTagsBulk: (data: VolumeTagsBulkRequest) =>
    fetchAPI<VolumeTagsBulkResponse>("/admin/data-sources/volume-tags/bulk", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  removeVolumeTagsBulk: (data: VolumeTagsBulkRequest) =>
    fetchAPI<VolumeTagsBulkResponse>("/admin/data-sources/volume-tags/bulk-remove", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
