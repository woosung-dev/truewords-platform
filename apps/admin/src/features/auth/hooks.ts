"use client";

import { useQuery } from "@tanstack/react-query";
import { authAPI } from "./api";

/** 현재 관리자 계정. AuthGuard 와 화면(설정 등)이 같은 키를 써서 요청은 한 번만 나간다. */
export function useMe() {
  // 401(미인증)과 일시 오류는 AuthGuard 가 구분해 처리하므로 자동 재시도하지 않는다.
  return useQuery({ queryKey: ["auth", "me"], queryFn: authAPI.me, retry: false });
}
