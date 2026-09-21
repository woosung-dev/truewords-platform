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
  const reading = personalized ?? (regularToday?.status === "available" ? regularToday.reading : null);
  let reason: string | null = null;
  if (identity.isError || (isPersonal && personal.isError))
    reason = "정성 말씀을 확인하지 못해 일반 편성을 보여드려요.";
  else if (isPersonal && personal.data?.reason === "no_candidates")
    reason = "오늘 주제에 맞는 정성 말씀을 찾지 못해 일반 편성을 보여드려요.";
  else if (isPersonal && personal.data?.reason === "rights_withdrawn")
    reason = "정성 말씀의 공개 권한이 바뀌어 일반 편성을 보여드려요.";
  else if (isPersonal && personal.data?.reason === "upcoming") reason = "정성 시작일 전이라 일반 편성을 보여드려요.";
  if (regular.isError && !personalized) reason = "오늘 편성을 불러오지 못했어요. 연결을 확인해 주세요.";
  return {
    reading,
    status: reading
      ? ("available" as const)
      : regularToday?.status === "withdrawn"
        ? ("withdrawn" as const)
        : ("none" as const),
    reason,
    isResolving,
    isPersonalLoading: isPersonal && personal.isPending,
    date,
  };
}
