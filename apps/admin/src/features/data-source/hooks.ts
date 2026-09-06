import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataAPI, dataSourceCategoryAPI } from "./api";
import type {
  CategoryDocumentStats,
  DataSourceCategory,
  IngestionJobInfo,
  VolumeInfo,
  VolumeTagRequest,
  VolumeTagsBulkRequest,
} from "./types";

export function useDataSourceCategories() {
  return useQuery({
    queryKey: ["data-source-categories"],
    queryFn: dataSourceCategoryAPI.list,
    staleTime: 5 * 60 * 1000, // 5분 캐시
  });
}

export function useActiveCategories() {
  const query = useDataSourceCategories();
  return {
    ...query,
    data: query.data?.filter((c: DataSourceCategory) => c.is_active),
  };
}

export function useSearchableCategories() {
  const query = useDataSourceCategories();
  return {
    ...query,
    data: query.data?.filter((c: DataSourceCategory) => c.is_searchable && c.is_active),
  };
}

export function useCategoryStats() {
  return useQuery<CategoryDocumentStats[]>({
    queryKey: ["category-stats"],
    queryFn: dataSourceCategoryAPI.getCategoryStats,
    staleTime: 60_000, // 60초 캐시
  });
}

export function useAddVolumeTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: VolumeTagRequest) => dataSourceCategoryAPI.addVolumeTag(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category-stats"] });
    },
  });
}

export function useRemoveVolumeTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: VolumeTagRequest) => dataSourceCategoryAPI.removeVolumeTag(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category-stats"] });
    },
  });
}

export function useAllVolumes() {
  return useQuery<VolumeInfo[]>({
    queryKey: ["all-volumes"],
    queryFn: dataSourceCategoryAPI.getAllVolumes,
    staleTime: 60_000,
  });
}

export function useAddVolumeTagsBulk() {
  return useMutation({
    mutationFn: (data: VolumeTagsBulkRequest) => dataSourceCategoryAPI.addVolumeTagsBulk(data),
  });
}

export function useRemoveVolumeTagsBulk() {
  return useMutation({
    mutationFn: (data: VolumeTagsBulkRequest) => dataSourceCategoryAPI.removeVolumeTagsBulk(data),
  });
}

export function useIngestionJobs() {
  return useQuery<IngestionJobInfo[]>({
    queryKey: ["ingestion-jobs"],
    queryFn: dataAPI.getJobs,
    staleTime: 30_000,
  });
}
