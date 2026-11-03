"use client";

import { useEffect } from "react";
import { isHoondokEnabled } from "@/features/hoondok/flag";
import { reportClientError } from "./observability/report";

export const HOONDOK_SW_URL = "/sw.js";
export const HOONDOK_SW_SCOPE = "/";
/** 웹 루트 이전(DEC-PWA-026) 전의 등록 scope. 남아 있으면 해제한다 — 은퇴 스크립트(public/hoondok/sw.js)도 같은 일을 한다. */
export const LEGACY_SW_SCOPE = "/hoondok";

/** 예전 /hoondok scope 등록을 해제한다. 그 등록의 푸시 구독도 함께 사라진다(설정 화면이 "다시 켜 주세요" 를 띄운다). */
async function unregisterLegacy(container: ServiceWorkerContainer): Promise<void> {
  const legacyScope = new URL(LEGACY_SW_SCOPE, window.location.origin).href;
  const registrations = await container.getRegistrations();
  await Promise.all(registrations.filter((r) => r.scope === legacyScope).map((r) => r.unregister()));
}

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
    // 해제 실패는 무해하다 — 그 등록은 /hoondok/* 만 잡고, 그 주소는 서버가 루트로 308 한다.
    unregisterLegacy(container).catch(() => undefined);
  }, []);
  return null;
}
