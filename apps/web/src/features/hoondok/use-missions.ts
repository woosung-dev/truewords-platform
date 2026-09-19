"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useIdentityGate } from "@/features/identity/gate";
import type { HoondokUser } from "@/features/identity/types";
import { markInstallEligible } from "./install/storage";
import { type MissionKind, missionsAPI } from "./missions-api";
import { clearPending, readPending, subscribePending, writePending } from "./pending";
import { PROGRESS_KEYS, SUMMARY_KEY } from "./query-keys";

// 기존 import 경로 유지 (onboarding 등). 새 코드는 ./query-keys 에서 직접 가져간다.
export { SUMMARY_KEY };

export function useSummary(isEnabled: boolean) {
  return useQuery({ queryKey: SUMMARY_KEY, queryFn: missionsAPI.summary, enabled: isEnabled, retry: 1 });
}

export type CompleteResult = "recorded" | "already" | "pending-local" | "unauthorized";
/** 호출 출처 — 사용자가 직접 누른 완료(user)와 로그인 뒤 로컬 키 소급(sync). 설치 안내는 user 만 본다. */
export type CompleteSource = "user" | "sync";

/**
 * 미션 완료 한 번의 결과 규칙:
 * - 201 → recorded, 409(하루 1회) → already: 둘 다 완료로 보고 진행 상태 캐시(PROGRESS_KEYS: 요약·정성·기록)를 다시 읽는다
 * - 401 → unauthorized: 호출자가 온보딩으로 보낸다 (returnTo = 현재 경로)
 * - 그 외(오프라인·5xx) → pending-local: 로컬 완료 표시를 유지하고 다음 로그인/방문 때 소급한다
 * - recorded 이면서 출처가 user 인 첫 완료 뒤에만 설치 안내 카드가 자격을 얻는다 (Phase 3 E, 소급 제외)
 */
export function useCompleteMission(kind: MissionKind) {
  const queryClient = useQueryClient();
  const { redirectToOnboarding } = useIdentityGate();
  return useMutation<CompleteResult, never, CompleteSource>({
    mutationFn: async () => {
      try {
        await missionsAPI.complete(kind);
        clearPending(kind);
        return "recorded";
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          clearPending(kind);
          return "already";
        }
        if (error instanceof ApiError && error.status === 401) return "unauthorized";
        writePending(kind);
        return "pending-local";
      }
    },
    onSuccess: (result, source) => {
      if (result === "recorded" || result === "already")
        for (const queryKey of PROGRESS_KEYS) void queryClient.invalidateQueries({ queryKey });
      if (result === "unauthorized") redirectToOnboarding();
      if (result === "recorded" && source === "user") markInstallEligible();
    },
  });
}

/**
 * 하루 1회·소급 규칙을 한 곳에 모은 훅.
 * - 비로그인 클릭: localStorage 에 오늘(KST) 키를 쓰고 완료로 표시
 * - 로그인 직후/재방문: 오늘 키가 남아 있으면 한 번만 소급 POST (어제 키는 pending.ts 가 버린다)
 */
export function useMissionCompletion(kind: MissionKind, user: HoondokUser | null, isUserLoading: boolean) {
  const complete = useCompleteMission(kind);
  // localStorage 는 외부 저장소로 구독한다 — 서버 스냅샷은 false 라 SSR 과 첫 렌더가 같다.
  const isLocalDone = useSyncExternalStore(
    subscribePending,
    () => readPending(kind),
    () => false,
  );
  const hasSynced = useRef(false);

  useEffect(() => {
    if (isUserLoading || !user || hasSynced.current || !readPending(kind)) return;
    hasSynced.current = true;
    complete.mutate("sync");
  }, [isUserLoading, user, kind, complete]);

  const markDone = () => {
    if (!user) {
      writePending(kind);
      return;
    }
    complete.mutate("user");
  };

  const result = complete.data;
  const isDone = isLocalDone || result === "recorded" || result === "already" || result === "pending-local";
  const isUnsynced = isLocalDone && !user;
  const hasSaveFailed = result === "pending-local";
  return { isDone, isUnsynced, hasSaveFailed, isSaving: complete.isPending, markDone };
}
