"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { identityAPI } from "./api";
import { CURRENT_USER_KEY } from "./use-current-user";

/** 훈독이 이 브라우저에 남기는 localStorage 키 접두 (pending·install·note). */
const HOONDOK_STORAGE_PREFIX = "hoondok:";

/** `hoondok:` 접두 키 전부 제거. 저장소는 없거나 던질 수 있으므로 try/catch — 실패해도 삭제 흐름은 계속된다. */
export function clearHoondokStorage(): void {
  try {
    const store = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(HOONDOK_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // 사생활 모드·차단 — 무시
  }
}

/**
 * 내 데이터 삭제 (API-HD-011). 성공 시:
 * 1. ["hoondok"] 접두 캐시 제거 (요약·정성·기록·me)
 * 2. me 캐시를 null 로 다시 세워 관찰자가 재요청 없이 "미인증" 을 본다
 * 3. localStorage 의 hoondok:* 제거
 * /hoondok 이동은 호출자(설정 화면)가 한다. 실패(403 CSRF·5xx)는 error 로 남기고 아무것도 건드리지 않는다.
 */
export function useDeleteMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: identityAPI.deleteMe,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["hoondok"] });
      queryClient.setQueryData(CURRENT_USER_KEY, null);
      clearHoondokStorage();
    },
  });
}
