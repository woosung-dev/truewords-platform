"use client";

import { useQuery } from "@tanstack/react-query";
import { libraryAPI } from "../library/api";
import { highlightsKey } from "../query-keys";
import { type RecordSet, toRecords } from "./records";

/**
 * 내 형광펜·노트(API-HD-053, 상한 500, 최신순).
 * 정원 '나의 기록'과 나의 기록 화면이 같은 캐시를 본다. 원문에서 형광펜을 바꾸면 접두 무효화로 함께 새로 읽는다.
 * 기록은 로그인 전용이라 비로그인은 요청을 보내지 않는다 — 401 을 오류로 쌓지 않기 위해서다.
 */
export function useRecords(isEnabled: boolean) {
  const highlights = useQuery({
    queryKey: highlightsKey(),
    queryFn: () => libraryAPI.highlights(),
    enabled: isEnabled,
    retry: false,
    staleTime: 0,
  });
  const data: RecordSet | undefined = highlights.data ? toRecords(highlights.data.items) : undefined;
  return {
    data,
    isError: highlights.isError,
    isPending: highlights.isPending,
    isFetching: highlights.isFetching,
    refetch: () => void highlights.refetch(),
  };
}
