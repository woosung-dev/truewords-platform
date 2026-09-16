"use client";

import { ApiError } from "@truewords/api-client-ts";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { useCurrentUser } from "./use-current-user";

const ONBOARDING = "/hoondok/onboarding";

/** returnTo 는 /hoondok 아래 상대 경로만 허용한다 (open redirect 방지). 아니면 홈. */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || raw.startsWith("//") || raw.startsWith(ONBOARDING)) return "/hoondok";
  return /^\/hoondok(\/|\?|$)/.test(raw) ? raw : "/hoondok";
}

export function onboardingHref(returnTo?: string | null): string {
  return `${ONBOARDING}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * 훈독 게이트. 홈·훈독하기는 비로그인 열람이 원칙(Phase 1)이라 화면을 막지 않고,
 * 완료 같은 "행동" 이 401 을 받았을 때만 온보딩으로 보낸다(returnTo = 현재 경로).
 */
export function useIdentityGate() {
  const { user, isLoading } = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const redirectToOnboarding = useCallback(() => {
    router.push(onboardingHref(pathname));
  }, [router, pathname]);
  return { user, isLoading, redirectToOnboarding };
}
