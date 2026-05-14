import { ApiError, fetchAPI, throwApiError } from "@/lib/api";
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

    // FormData requests don't use "Content-Type: application/json"
    // Fetch automatically applies the correct multipart/form-data boundary
    const headers = {
      "X-Requested-With": "XMLHttpRequest",
    }

    const res = await fetch(`/admin/data-sources/upload`, {
      method: "POST",
      credentials: "include",
      headers,
      body: formData,
    })

    if (res.status === 401) {
      if (typeof window !== "undefined") {
        window.location.href = "/login"
      }
      throw new ApiError(401, {
        error_code: "UNAUTHORIZED",
        message: "인증이 필요합니다",
      })
    }

    if (!res.ok) {
      // multipart 응답도 일반 fetchAPI 와 동일한 ApiError 계약을 따른다 —
      // raw text 가 toast 에 노출되어 error_code / request_id 가 손실되던 결함 fix.
      await throwApiError(res)
    }

    return (await res.json()) as UploadResponse
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
  create: (data: Omit<DataSourceCategory, "id">) =>
    fetchAPI<DataSourceCategory>("/admin/data-source-categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<DataSourceCategory>) =>
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
