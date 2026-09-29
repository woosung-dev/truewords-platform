"use client";

import { useQuery } from "@tanstack/react-query";
import { libraryAPI } from "../library/api";
import { highlightsKey, RECORD_MARKS_KEY } from "../query-keys";
import { type RecordSet, toRecords } from "./records";

/**
 * 내 형광펜·노트(API-HD-053, 상한 500)와 발췌가 붙은 북마크(API-HD-026, 상한 200). 둘 다 최신순이다.
 * 정원 '나의 기록'과 나의 기록 화면이 같은 캐시를 본다. 원문에서 형광펜·북마크를 바꾸면 접두 무효화로 함께 새로 읽는다.
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
  const bookmarks = useQuery({
    queryKey: RECORD_MARKS_KEY,
    queryFn: () => libraryAPI.marks({ excerpt: true }),
    enabled: isEnabled,
    retry: false,
    staleTime: 0,
  });
  const data: RecordSet | undefined =
    highlights.data && bookmarks.data ? toRecords(highlights.data.items, bookmarks.data.items) : undefined;
  return {
    data,
    // 한쪽만 실패해도 수가 틀리지 않게 기록 전체를 오류로 둔다
    isError: highlights.isError || bookmarks.isError,
    isPending: highlights.isPending || bookmarks.isPending,
    refetch: () => {
      if (highlights.isError) void highlights.refetch();
      if (bookmarks.isError) void bookmarks.refetch();
    },
  };
}
