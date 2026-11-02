"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { authAPI } from "./api";

/** 현재 시연 계정. AuthGuard 와 화면이 같은 키를 써서 요청은 한 번만 나간다. */
export function useMe() {
  // 401(미인증)과 일시 오류는 AuthGuard 가 구분해 처리하므로 자동 재시도하지 않는다.
  return useQuery({ queryKey: ["auth", "me"], queryFn: authAPI.me, retry: false });
}

/** 시연 계정 로그아웃 — 서버 쿠키를 지우고 캐시를 비운 뒤 로그인으로 이동한다. */
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await authAPI.logout();
    } finally {
      queryClient.clear();
      router.push("/login");
    }
  }, [router, queryClient]);
}
