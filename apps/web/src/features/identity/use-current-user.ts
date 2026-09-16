"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { identityAPI } from "./api";
import type { HoondokUser } from "./types";

export const CURRENT_USER_KEY = ["hoondok", "me"] as const;

/** 401 은 "미인증(null)". 5xx·네트워크 단절은 error 로 남겨 오프라인을 미인증으로 오판하지 않는다. */
export async function fetchCurrentUser(): Promise<HoondokUser | null> {
  try {
    return (await identityAPI.me()).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function useCurrentUser() {
  const query = useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 5 * 60_000,
  });
  return { user: query.data ?? null, isLoading: query.isPending, isError: query.isError, refetch: query.refetch };
}
