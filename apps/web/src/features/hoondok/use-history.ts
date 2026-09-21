"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { historyAPI, type MonthHistoryResponse } from "./history-api";
import { historyKey } from "./query-keys";
import { useKstDate } from "./use-kst-date";

/** 한 달 기록. 401 은 "미인증(null)", 5xx·네트워크는 error 로 남긴다. */
export async function fetchMonthHistory(month: string): Promise<MonthHistoryResponse | null> {
  try {
    return await historyAPI.month(month);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** month 는 `YYYY-MM` (kstMonthKey). 키가 월별이라 이전/다음 달이 각각 캐시되고, 미션 완료 시 접두 무효화에 함께 잡힌다. */
export function useMonthHistory(month: string, isEnabled: boolean) {
  const { user } = useCurrentUser();
  const date = useKstDate();
  return useQuery({
    queryKey: [...historyKey(month), user?.id ?? null, date],
    queryFn: () => fetchMonthHistory(month),
    enabled: isEnabled,
  });
}
