"use client";

import { useQuery } from "@tanstack/react-query";
import { TOGETHER_KEY } from "../query-keys";
import { useKstDate } from "../use-kst-date";
import { togetherAPI } from "./api";

/** 오늘(KST) 함께 읽은 식구 수. 날짜가 키에 있어 자정을 넘기면 새로 읽는다. 사용자별 값이 아니라 user id 는 넣지 않는다. */
export function useTogether() {
  const date = useKstDate();
  return useQuery({
    queryKey: [...TOGETHER_KEY, date],
    queryFn: togetherAPI.today,
    retry: 1,
  });
}

/** 1,284 처럼 천 단위 쉼표. */
export function formatCount(count: number): string {
  return count.toLocaleString("ko-KR");
}
