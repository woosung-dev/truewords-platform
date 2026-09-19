"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { type JeongseongCreate, type JeongseongPeriodResponse, jeongseongAPI } from "./jeongseong-api";
import { JEONGSEONG_KEY, SUMMARY_KEY } from "./query-keys";

/** 진행 중인 정성. 401 은 "미인증(null)" — 비로그인 홈에서 조용히 지나간다. 5xx·네트워크는 error 로 남긴다. */
export async function fetchJeongseong(): Promise<JeongseongPeriodResponse | null> {
  try {
    return (await jeongseongAPI.current()).period ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** data = 진행 중인 기간 | null. 없음·미인증 둘 다 null 이며, 로그인 여부는 useCurrentUser 가 안다. */
export function useJeongseong(isEnabled: boolean) {
  return useQuery({ queryKey: JEONGSEONG_KEY, queryFn: fetchJeongseong, enabled: isEnabled });
}

/** 정성이 바뀌면 홈 카드(정성)와 요약을 함께 다시 읽는다. */
function invalidateJeongseong(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: JEONGSEONG_KEY });
  void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
}

/** 401 신호 — 사람이 읽는 문구가 아니다. 호출자는 이 값을 받으면 onboardingHref(현재 경로) 로 보낸다. */
export const UNAUTHORIZED = "unauthorized";

/** 정성 시작 실패를 화면 문구로. 409 는 서버 문구 대신 고정 문구 — 시트 안내와 홈 카드가 같은 말을 한다. */
export function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return UNAUTHORIZED;
    if (error.status === 409) return "이미 진행 중인 정성이 있어요";
    if (error.status === 422) return "입력값을 확인해 주세요";
  }
  return "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요";
}

/** 정성 시작 (201). 성공 시 정성·요약 캐시를 다시 읽는다. 실패 분류는 createErrorMessage. */
export function useCreateJeongseong() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: JeongseongCreate) => jeongseongAPI.create(body),
    onSuccess: () => invalidateJeongseong(queryClient),
  });
}

/** 그만두기 (204). 404(이미 없음)도 "없어진 상태" 로 같게 보고 캐시를 다시 읽는다. 403·5xx 는 error. */
export function useAbandonJeongseong() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await jeongseongAPI.abandon();
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    },
    onSuccess: () => invalidateJeongseong(queryClient),
  });
}
