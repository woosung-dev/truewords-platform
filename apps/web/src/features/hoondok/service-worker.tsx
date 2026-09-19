"use client";

import { useEffect } from "react";
import { isHoondokEnabled } from "@/features/hoondok/flag";

export const HOONDOK_SW_URL = "/hoondok/sw.js";
export const HOONDOK_SW_SCOPE = "/hoondok";

// 훈독 SW 등록 (PLAN-HD-001 Phase 3 D). hoondok layout 에서만 렌더하므로 시연 챗 `/` 에는 등록되지 않는다.
// scope 는 슬래시 없는 /hoondok (C-3) — next.config 의 Service-Worker-Allowed 헤더가 이를 허용한다.
export function HoondokServiceWorker() {
  useEffect(() => {
    if (!isHoondokEnabled() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(HOONDOK_SW_URL, { scope: HOONDOK_SW_SCOPE }).catch((error: unknown) => {
      // 등록 실패 보고는 Phase 3 H(클라이언트 오류 수집) 몫이다. 지금은 콘솔 경고만 남기고 앱은 그대로 동작한다.
      console.warn("[hoondok] 서비스워커 등록 실패", error);
    });
  }, []);
  return null;
}
