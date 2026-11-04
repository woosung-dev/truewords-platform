"use client";

import { useEffect } from "react";
import { isHoondokEnabled } from "@/features/hoondok/flag";
import { retireLegacyRegistration } from "./notifications/legacy-push";
import { reportClientError } from "./observability/report";

export const HOONDOK_SW_URL = "/sw.js";
export const HOONDOK_SW_SCOPE = "/";

// 훈독 SW 등록 (PLAN-HD-001 Phase 3 D). 웹 루트가 훈독이라(DEC-PWA-026) 스크립트는 /sw.js, scope 는 `/` 다.
//
// updateViaCache: "none" 은 킬스위치의 생명줄이다. Cloudflare 가 sw.js 의 오리진 `no-cache` 를
// Browser Cache TTL 기본값(4시간)으로 덮어쓰기 때문에(2026-09-19 실측, runbook §Cloudflare 캐시),
// 브라우저가 HTTP 캐시를 보면 SW_KILL 배포가 최대 4시간 지연된다. 기본값 "imports" 도 최상위
// 스크립트는 캐시를 우회하지만 importScripts 는 우회하지 않는다 — "none" 은 둘 다 막아서
// 앞으로 sw.js 가 무엇을 import 하든 이 보장이 깨지지 않는다.
export function HoondokServiceWorker() {
  useEffect(() => {
    if (!isHoondokEnabled() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    container
      .register(HOONDOK_SW_URL, { scope: HOONDOK_SW_SCOPE, updateViaCache: "none" })
      .catch(() => reportClientError("sw_register"));
    // 예전 /hoondok 등록은 알림 구독을 루트 등록으로 옮긴 뒤에만 해제한다. 실패는 무해하다 — 그 등록은 /hoondok/* 만 잡고
    // (서버가 루트로 308 한다) 은퇴 스크립트가 알림을 계속 띄우며, 다음 방문에서 다시 시도한다.
    retireLegacyRegistration(container).catch(() => undefined);
  }, []);
  return null;
}
