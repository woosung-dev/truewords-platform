// analytics 도메인 React Query 훅.

import { useQuery } from "@tanstack/react-query";
import { analyticsAPI } from "./api";
import { analyticsKeys } from "./keys";

export function useSearchStats(days: number = 30) {
  return useQuery({
    queryKey: analyticsKeys.searchStats(days),
    queryFn: () => analyticsAPI.getSearchStats(days),
  });
}

export function useDailyTrend(days: number = 30) {
  return useQuery({
    queryKey: analyticsKeys.dailyTrend(days),
    queryFn: () => analyticsAPI.getDailyTrend(days),
  });
}

export function useTopQueries(days: number = 30, limit: number = 10) {
  return useQuery({
    queryKey: analyticsKeys.topQueries(days, limit),
    queryFn: () => analyticsAPI.getTopQueries(days, limit),
  });
}

export function useDailyModes(days: number = 30) {
  return useQuery({
    queryKey: analyticsKeys.dailyModes(days),
    queryFn: () => analyticsAPI.getDailyModes(days),
  });
}
