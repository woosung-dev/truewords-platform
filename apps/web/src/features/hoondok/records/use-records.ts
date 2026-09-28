"use client";

import { useQuery } from "@tanstack/react-query";
import { libraryAPI } from "../library/api";
import { RECORD_MARKS_KEY } from "../query-keys";

/**
 * 발췌가 붙은 내 표시 전체(최신순, 상한 200). 정원 '나의 기록'과 나의 기록 화면이 같은 캐시를 본다.
 * 기록은 로그인 전용이라 비로그인은 요청을 보내지 않는다 — 401 을 오류로 쌓지 않기 위해서다.
 */
export function useRecordMarks(isEnabled: boolean) {
  return useQuery({
    queryKey: RECORD_MARKS_KEY,
    queryFn: () => libraryAPI.marks({ excerpt: true }),
    enabled: isEnabled,
    retry: false,
    staleTime: 0,
  });
}
