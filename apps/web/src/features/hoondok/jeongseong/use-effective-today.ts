"use client";

import { useQuery } from "@tanstack/react-query";
import { createApiClient } from "@truewords/api-client-ts";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { jeongseongAPI } from "../jeongseong-api";
import { hoondokFetch } from "../observability/report";
import { JEONGSEONG_TODAY_KEY } from "../query-keys";
import type { TodayResponse } from "../today";
import { useKstDate } from "../use-kst-date";

const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });

/** 홈·읽기가 같은 사용자/날짜 쿼리를 공유한다. 비공개 말씀은 서버 렌더로 보내지 않는다. */
export function useEffectiveToday(initialToday: TodayResponse) {
  const date = useKstDate();
  const identity = useCurrentUser();
  const regular = useQuery({
    queryKey: ["hoondok", "today", date],
    queryFn: () => request<TodayResponse>("/hoondok/today", { cache: "no-store" }),
    initialData: initialToday.date === date ? initialToday : undefined,
    staleTime: 60_000,
    retry: false,
  });
  const personal = useQuery({
    queryKey: [...JEONGSEONG_TODAY_KEY, identity.user?.id ?? null, date],
    queryFn: jeongseongAPI.today,
    enabled: Boolean(identity.user) && !identity.isError,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const isPersonal = Boolean(identity.user) && !identity.isError;
  const personalized =
    isPersonal && !personal.isError && personal.data?.date === date && personal.data.status === "available"
      ? personal.data.reading
      : null;
  const isResolving = identity.isLoading || (isPersonal && personal.isPending) || (!personalized && regular.isPending);
  const regularToday = regular.data?.date === date ? regular.data : undefined;
  // 서버 렌더가 API 를 못 읽으면 status "none" + error 로 온다(loadToday) — 편성 없는 날이 아니라 조회 실패다
  const isRegularError = regular.isError || Boolean(regularToday?.error);
  const hasRegular = regularToday?.status === "available";
  const reading = personalized ?? (hasRegular ? regularToday.reading : null);
  // 일반 편성도 없는 날에는 "일반 편성을 보여드려요" 가 사실이 아니라 이유만 말한다
  const withRegular = (fallback: string, alone: string) => (hasRegular ? fallback : alone);
  let reason: string | null = null;
  if (identity.isError || (isPersonal && personal.isError))
    reason = withRegular("정성 말씀을 확인하지 못해 일반 편성을 보여드려요.", "정성 말씀을 확인하지 못했어요.");
  else if (isPersonal && personal.data?.reason === "no_candidates")
    reason = withRegular(
      "오늘 주제에 맞는 정성 말씀을 찾지 못해 일반 편성을 보여드려요.",
      "오늘 주제에 맞는 정성 말씀을 찾지 못했어요.",
    );
  else if (isPersonal && personal.data?.reason === "rights_withdrawn")
    reason = withRegular(
      "정성 말씀의 공개 권한이 바뀌어 일반 편성을 보여드려요.",
      "정성 말씀의 공개 권한이 바뀌었어요.",
    );
  else if (isPersonal && personal.data?.reason === "upcoming")
    reason = withRegular("정성 시작일 전이라 일반 편성을 보여드려요.", "정성 시작일 전이에요.");
  // 보여 줄 말씀 없이 조회만 실패했다 — 이때만 다시 불러오기를 둔다(대체 편성 안내에는 다시 불러올 것이 없다)
  const isLoadError = isRegularError && !personalized;
  if (isLoadError) reason = "오늘 편성을 불러오지 못했어요. 연결을 확인해 주세요.";
  return {
    reading,
    status: reading
      ? ("available" as const)
      : regularToday?.status === "withdrawn"
        ? ("withdrawn" as const)
        : ("none" as const),
    reason,
    isLoadError,
    isRetrying: regular.isFetching,
    retry: () => {
      void regular.refetch();
      if (isPersonal) void personal.refetch();
    },
    isResolving,
    isPersonalLoading: isPersonal && personal.isPending,
    /** 편성 없는 날(행 없음·철회). 확인 중·조회 실패는 아니다. 대체 말씀 없이 이어 읽기·서고로 안내한다(C3) */
    isEmptyDay: !reading && !isResolving && !isRegularError && regularToday !== undefined,
    date,
  };
}
