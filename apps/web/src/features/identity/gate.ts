"use client";

import { ApiError } from "@truewords/api-client-ts";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { formatInviteCode, JOIN_PATH } from "@/features/hoondok/together/invite-code";
import { useCurrentUser } from "./use-current-user";

const ONBOARDING = "/hoondok/onboarding";

/** returnTo 는 /hoondok 아래 상대 경로만 허용한다 (open redirect 방지). 아니면 홈. */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || raw.startsWith("//") || raw.startsWith(ONBOARDING)) return "/hoondok";
  return /^\/hoondok(\/|\?|$)/.test(raw) ? raw : "/hoondok";
}

/**
 * 모임 참여 링크(`/hoondok/groups/join?code=…`)에서 온 가입이면 그 코드를 가입 폼 초대 코드 칸에 미리 채운다
 * (PLAN-HD-010 D4 — 유효한 모임 코드가 베타 게이트를 대신 통과한다). 그 외 returnTo 는 빈 문자열.
 * 값은 표시·전송용일 뿐이고 판정은 서버가 한다.
 */
export function inviteCodeFromReturnTo(returnTo: string): string {
  const [path, query = ""] = returnTo.split("?", 2);
  if (path.replace(/\/$/, "") !== JOIN_PATH) return "";
  const code = new URLSearchParams(query).get("code");
  return code ? formatInviteCode(code).slice(0, 64) : "";
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
