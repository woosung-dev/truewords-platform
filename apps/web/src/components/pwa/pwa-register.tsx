"use client";

import { useEffect } from "react";

export const PWA_FLAG = "NEXT_PUBLIC_PWA_ENABLED";
export const SW_PATH = "/sw.js";

export function isPwaEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PWA_ENABLED === "1";
}

/**
 * 훈독 PWA 서비스워커 등록 (플래그 게이트).
 * NEXT_PUBLIC_PWA_ENABLED=1 이 아닐 때는 아무것도 하지 않아 기존 화면·쿠키 흐름에 영향이 없다.
 * 등록 실패는 조용히 무시한다 — 서비스워커 없이도 모든 읽기 기능이 동작해야 한다 (REQ-PWA-009).
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPwaEnabled() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker.register(SW_PATH, { scope: "/" }).catch(() => null);
}

export default function PwaRegister() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}
