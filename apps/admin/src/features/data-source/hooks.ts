import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataAPI, dataSourceCategoryAPI } from "./api";
import type {
  CategoryDocumentStats,
  DataSourceCategory,
  IngestionJobInfo,
  VolumeInfo,
  VolumeTagRequest,
  VolumeTagsBulkRequest,
} from "./types";

const categoriesQuery = queryOptions({
  queryKey: ["data-source-categories"],
  queryFn: dataSourceCategoryAPI.list,
  staleTime: 5 * 60 * 1000, // 5분 캐시
});

export function useDataSourceCategories() {
  return useQuery(categoriesQuery);
}

// select 는 모듈 함수로 둬야 데이터가 같을 때 같은 배열 참조를 돌려준다(렌더마다 새 배열 방지).
const selectActive = (categories: DataSourceCategory[]) => categories.filter((c) => c.is_active);
const selectSearchable = (categories: DataSourceCategory[]) => categories.filter((c) => c.is_searchable && c.is_active);

export function useActiveCategories() {
  return useQuery({ ...categoriesQuery, select: selectActive });
}

export function useSearchableCategories() {
  return useQuery({ ...categoriesQuery, select: selectSearchable });
}

export function useCategoryStats() {
  return useQuery<CategoryDocumentStats[]>({
    queryKey: ["category-stats"],
    queryFn: dataSourceCategoryAPI.getCategoryStats,
    staleTime: 60_000, // 60초 캐시
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
