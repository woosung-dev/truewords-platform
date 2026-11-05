"use client";

import { useEffect } from "react";
import { safeLocalStorage } from "@/lib/safe-storage";

// 개편 전에는 질문·답을 이 브라우저 localStorage(`hoondok:ask:items`)에 두었다. 이제 계정에만 보관하므로(DEC-PWA-025 2차)
// 예전 기록은 읽거나 옮기지 않고 AI 질문 화면에 들어올 때 지운다. 저장소가 없거나 던져도(사생활 모드) 화면은 계속된다.
const LEGACY_KEY = "hoondok:ask:items";
export function clearLegacyAskItems(): void {
  try {
    safeLocalStorage()?.removeItem(LEGACY_KEY);
  } catch {
    // 차단된 저장소
  }
}

/** AI 질문 화면이 마운트될 때 한 번. */
export function useClearLegacyAskItems(): void {
  useEffect(clearLegacyAskItems, []);
}
