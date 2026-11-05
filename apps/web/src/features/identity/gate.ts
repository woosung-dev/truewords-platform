"use client";

import { ApiError } from "@truewords/api-client-ts";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { useCurrentUser } from "./use-current-user";

const ONBOARDING = "/onboarding";

/** 웹 루트 이전(DEC-PWA-026) 전 주소의 접두. 배포 전에 열린 탭·저장된 링크의 returnTo 에 남아 있다. */
const LEGACY_PREFIX = /^\/hoondok(?=[/?#]|$)/;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * returnTo 는 같은 origin 의 절대 경로(`/…`)만 허용한다 (open redirect 방지 — `//`·`/\` 로 시작하면 다른 호스트로 해석된다). 아니면 홈.
 * 예전 `/hoondok/…` 주소는 루트 경로로 바꾼 뒤 검사한다 — 308 을 한 번 덜 탄다.
 * 제어 문자(탭·줄바꿈 등)가 있으면 홈 — 브라우저 URL 파서가 지워 `/\t/evil.example` 이 `//evil.example` 이 된다.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || hasControlChar(raw)) return "/";
  const path = raw.replace(LEGACY_PREFIX, "");
  const normalized = path === "" || /^[?#]/.test(path) ? `/${path}` : path;
  if (normalized.startsWith(ONBOARDING)) return "/";
  return /^\/(?![/\\])/.test(normalized) ? normalized : "/";
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
