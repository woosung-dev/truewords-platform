"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useIdentityGate } from "@/features/identity/gate";
import type { HoondokUser } from "@/features/identity/types";
import { CURRENT_USER_KEY, useCurrentUser } from "@/features/identity/use-current-user";
import { markInstallEligible } from "./install/storage";
import { type MissionKind, missionsAPI } from "./missions-api";
import { clearPending, readPending, subscribePending, writePending } from "./pending";
import { PROGRESS_KEYS, SUMMARY_KEY } from "./query-keys";
import { formatKstDate } from "./today";
import { useKstDate } from "./use-kst-date";

// 기존 import 경로 유지 (onboarding 등). 새 코드는 ./query-keys 에서 직접 가져간다.
export { SUMMARY_KEY };

export function useSummary(isEnabled: boolean) {
  const { user } = useCurrentUser();
  const date = useKstDate();
  return useQuery({
    queryKey: [...SUMMARY_KEY, user?.id ?? null, date],
    queryFn: missionsAPI.summary,
    enabled: isEnabled,
    retry: 1,
  });
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
export function useCompleteMission(kind: MissionKind, scope = "", userId?: string) {
  const queryClient = useQueryClient();
  const { redirectToOnboarding } = useIdentityGate();
  return useMutation<CompleteResult, never, CompleteSource>({
    mutationKey: ["hoondok", "mission", kind, scope],
    mutationFn: async (source) => {
      const date = formatKstDate().iso;
      // 로그인 소급을 시작하면 익명 완료를 이 계정에 귀속한다. 실패해도 다른 계정에 넘기지 않는다.
      if (source === "sync" && userId && readPending(kind, date)) {
        writePending(kind, date, userId);
        clearPending(kind, date);
      }
      try {
        await missionsAPI.complete(kind);
        clearPending(kind, date, userId);
        return "recorded";
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          clearPending(kind, date, userId);
          return "already";
        }
        if (error instanceof ApiError && error.status === 401) return "unauthorized";
        writePending(kind, date, userId);
        return "pending-local";
      }
    },
    onSuccess: (result, source) => {
      if (userId && queryClient.getQueryData<HoondokUser | null>(CURRENT_USER_KEY)?.id !== userId) return;
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
  const date = useKstDate();
  const scope = `${user?.id ?? "anonymous"}:${date}`;
  const complete = useCompleteMission(kind, scope, user?.id);
  // localStorage 는 외부 저장소로 구독한다 — 서버 스냅샷은 false 라 SSR 과 첫 렌더가 같다.
  const isLocalDone = useSyncExternalStore(
    subscribePending,
    () => readPending(kind, date, user?.id) || (Boolean(user) && readPending(kind, date)),
    () => false,
  );
  const hasSynced = useRef<string | null>(null);

  useEffect(() => {
    if (isUserLoading || !user || hasSynced.current === scope || !isLocalDone) return;
    hasSynced.current = scope;
    complete.mutate("sync");
  }, [isUserLoading, user, complete, scope, isLocalDone]);

  const markDone = () => {
    if (isUserLoading) return;
    if (!user) {
      writePending(kind);
      return;
    }
    hasSynced.current = scope;
    complete.mutate("user");
  };

  const result = complete.data;
  const isDone = isLocalDone || result === "recorded" || result === "already" || result === "pending-local";
  const isUnsynced = isLocalDone && !user;
  const hasSaveFailed = result === "pending-local";
  return { isDone, isUnsynced, hasSaveFailed, isSaving: complete.isPending, markDone };
}
