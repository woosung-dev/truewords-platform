"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { isHoondokPathsEnabled } from "../flag";
import { PATH_RUN_KEY, PATHS_KEY, PROGRESS_KEYS, pathStepKey } from "../query-keys";
import { type PathRunFinishRequest, type PathRunStart, type PathRunView, pathAPI } from "./api";

// 7일 정성 React Query 어댑터. 진행 상태는 서버가 계산하고(읽은 장·다음 장·빈 날) 화면은 받은 값만 그린다.

/** ApiError 의 error_code. 서버 오류 형식이 아니면 undefined. */
export function pathErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.errorCode : undefined;
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** 401(미인증)·404(API 플래그 꺼짐)는 "정성 없음"으로 본다. 5xx·네트워크는 오류로 남긴다 — 없다고 단정하지 않는다. */
async function fetchCurrentRun(): Promise<PathRunView | null> {
  try {
    return (await pathAPI.current()).run;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return null;
    throw error;
  }
}

export type PathRunState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "error"; retry: () => void }
  | { status: "none" }
  | { status: "ready"; run: PathRunView };

/** 홈·읽기·마침표가 함께 쓰는 진행 중(또는 마침표 전 completed) run. 같은 키라 GET 은 한 번이다. */
export function usePathRun(): PathRunState {
  const isEnabled = isHoondokPathsEnabled();
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const query = useQuery({
    queryKey: [...PATH_RUN_KEY, user?.id ?? null],
    queryFn: fetchCurrentRun,
    enabled: isEnabled && Boolean(user),
    retry: false,
  });
  if (!isEnabled) return { status: "off" };
  if (isUserLoading) return { status: "loading" };
  if (!user) return { status: "anonymous" };
  if (query.isPending) return { status: "loading" };
  if (query.isError && query.data === undefined) return { status: "error", retry: () => void query.refetch() };
  return query.data ? { status: "ready", run: query.data } : { status: "none" };
}

export function usePaths(isEnabled: boolean) {
  return useQuery({ queryKey: PATHS_KEY, queryFn: () => pathAPI.list(), enabled: isEnabled, retry: false });
}

export function usePathStep(runId: string | null, day: number, isEnabled: boolean) {
  return useQuery({
    queryKey: pathStepKey(runId ?? "none", day),
    queryFn: () => pathAPI.step(day),
    enabled: isEnabled && Boolean(runId),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

function invalidateRun(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: PATH_RUN_KEY });
}

export function useStartPathRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PathRunStart) => pathAPI.start(body),
    onSuccess: () => invalidateRun(client),
  });
}

/** 그만하기. 404(이미 없음)도 "없어진 상태"로 같게 본다. */
export function useAbandonPathRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await pathAPI.abandon();
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    },
    onSuccess: () => invalidateRun(client),
  });
}

/** 장 완료. 그날 훈독하기 기록도 서버가 함께 남기므로 요약·기록·함께 읽기 캐시도 다시 읽는다. */
export function useCompletePathStep() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (day: number) => pathAPI.complete(day, { mode: "full" }),
    onSuccess: () => {
      invalidateRun(client);
      for (const key of PROGRESS_KEYS) void client.invalidateQueries({ queryKey: key });
    },
  });
}

export function useFinishPathRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PathRunFinishRequest) => pathAPI.finish(body),
    onSuccess: () => invalidateRun(client),
  });
}
