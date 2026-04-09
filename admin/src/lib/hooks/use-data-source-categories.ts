import { useQuery } from "@tanstack/react-query";
import {
  dataSourceCategoryAPI,
  type DataSourceCategory,
  type CategoryDocumentStats,
} from "@/lib/api";

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
