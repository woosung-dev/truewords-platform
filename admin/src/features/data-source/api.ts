import { fetchAPI } from "@/lib/api";
import type {
  DataSourceCategory,
  IngestionStatus,
  CategoryDocumentStats,
  VolumeTagRequest,
  VolumeTagResponse,
  VolumeInfo,
} from "./types";

export const dataAPI = {
  uploadFile: async (file: File, source: string, mode: "standard" | "batch" = "standard") => {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("source", source)
    formData.append("mode", mode)

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
      throw new Error("인증이 필요합니다")
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `요청 실패 (${res.status})`)
    }

    return res.json()
  },

  getStatus: () => fetchAPI<IngestionStatus>("/admin/data-sources/status"),
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
};
