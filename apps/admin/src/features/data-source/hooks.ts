import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataAPI, dataSourceCategoryAPI } from "./api";
import type {
  CategoryDocumentStats,
  DataSourceCategory,
  IngestionJobInfo,
  IngestionStatus,
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

export const ingestStatusQuery = queryOptions({
  queryKey: ["ingest-status"],
  queryFn: dataAPI.getStatus,
});

const INGEST_POLL_MS = 5000;
const INGEST_STALLED_POLL_MS = 30_000;
const INGEST_STALL_AFTER_MS = 2 * 60_000;

/** 진행 중 작업의 진척 표시. 값이 같으면 그동안 적재가 한 청크도 나아가지 않은 것이다. */
export function ingestProgressSignature(status: IngestionStatus | undefined): string {
  return Object.entries(status?.in_progress ?? {})
    .map(([file, p]) => `${file}:${p.next_chunk}/${p.total}`)
    .sort()
    .join("|");
}

/**
 * 적재 현황 폴링 간격. 업로드 직후이거나 서버가 진행 중 작업을 보고하는 동안 갱신한다.
 * 업로드 직후 표시는 화면에서 10초 뒤 지워지므로 그것만 기준으로 삼으면 긴 적재 도중 갱신이 멈춘다.
 * 서버는 한도로 멈춘 작업(PARTIAL)과 작업자가 죽어 남은 행도 진행 중으로 세므로, 진척이 2분간 없으면 30초로 늦춘다.
 */
export function ingestStatusRefetchInterval(
  hasLocalProcessing: boolean,
  status: IngestionStatus | undefined,
  msSinceProgress: number,
): number | false {
  if (hasLocalProcessing) return INGEST_POLL_MS;
  if ((status?.summary.in_progress_count ?? 0) === 0) return false;
  return msSinceProgress < INGEST_STALL_AFTER_MS ? INGEST_POLL_MS : INGEST_STALLED_POLL_MS;
}

export function useIngestionJobs() {
  return useQuery<IngestionJobInfo[]>({
    queryKey: ["ingestion-jobs"],
    queryFn: dataAPI.getJobs,
    staleTime: 30_000,
  });
}
