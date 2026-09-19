"use client";

import { useEffect } from "react";
import { isHoondokEnabled } from "@/features/hoondok/flag";

export const HOONDOK_SW_URL = "/hoondok/sw.js";
export const HOONDOK_SW_SCOPE = "/hoondok";

// 훈독 SW 등록 (PLAN-HD-001 Phase 3 D). hoondok layout 에서만 렌더하므로 시연 챗 `/` 에는 등록되지 않는다.
// scope 는 슬래시 없는 /hoondok (C-3) — next.config 의 Service-Worker-Allowed 헤더가 이를 허용한다.
//
// updateViaCache: "none" 은 킬스위치의 생명줄이다. Cloudflare 가 sw.js 의 오리진 `no-cache` 를
// Browser Cache TTL 기본값(4시간)으로 덮어쓰기 때문에(2026-09-19 실측, runbook §Cloudflare 캐시),
// 브라우저가 HTTP 캐시를 보면 SW_KILL 배포가 최대 4시간 지연된다. 기본값 "imports" 도 최상위
// 스크립트는 캐시를 우회하지만 importScripts 는 우회하지 않는다 — "none" 은 둘 다 막아서
// 앞으로 sw.js 가 무엇을 import 하든 이 보장이 깨지지 않는다.
export function HoondokServiceWorker() {
  useEffect(() => {
    if (!isHoondokEnabled() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(HOONDOK_SW_URL, { scope: HOONDOK_SW_SCOPE, updateViaCache: "none" })
      .catch((error: unknown) => {
        // 등록 실패 보고는 Phase 3 H(클라이언트 오류 수집) 몫이다. 지금은 콘솔 경고만 남기고 앱은 그대로 동작한다.
        console.warn("[hoondok] 서비스워커 등록 실패", error);
      });
  }, []);
  return null;
}
