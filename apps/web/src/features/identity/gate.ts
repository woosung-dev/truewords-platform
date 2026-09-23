"use client";

import { ApiError } from "@truewords/api-client-ts";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { extractInviteCode, formatInviteCode, JOIN_PATH } from "@/features/hoondok/together/invite-code";
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

/**
 * 가입 칸에 넣은 모임 코드를 참여 화면으로 넘긴다 (QA P2-11). returnTo 가 코드 없는 참여 화면일 때만
 * `?code=` 를 붙인다 — 베타 코드인지 모임 코드인지는 클라이언트가 모르므로 모양(8자)만 본다. 그 외에는 그대로.
 */
export function carryInviteCode(returnTo: string, typed: string): string {
  const [path, query = ""] = returnTo.split("?", 2);
  if (path.replace(/\/$/, "") !== JOIN_PATH) return returnTo;
  const params = new URLSearchParams(query);
  const code = extractInviteCode(typed);
  if (params.get("code") || !code) return returnTo;
  params.set("code", code);
  return `${JOIN_PATH}?${params.toString()}`;
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
