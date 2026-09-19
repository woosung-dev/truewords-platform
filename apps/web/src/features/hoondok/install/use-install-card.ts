"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isIos, isStandalone } from "./platform";
import { consumeDeferredPrompt, getDeferredPrompt } from "./prompt-store";
import { dismissInstallCard, markInstalled, readInstallState, subscribeInstall } from "./storage";

export type InstallVariant = "hidden" | "ios" | "prompt" | "manual";

/**
 * 순수 함수 — 저장소 → standalone → iOS → prompt 캡처 여부 순으로 판정한다.
 * 문자열 하나를 돌려주므로 useSyncExternalStore 스냅샷이 안정적이고, navigator 는 eligible 을 통과한 뒤에만 읽는다.
 */
export function getInstallVariant(now: number = Date.now()): InstallVariant {
  const { isEligible, isHidden, isInstalled } = readInstallState(now);
  if (!isEligible || isHidden || isInstalled) return "hidden";
  if (isStandalone()) return "hidden";
  if (isIos()) return "ios";
  return getDeferredPrompt() ? "prompt" : "manual";
}

// 서버·hydration 첫 렌더는 숨김 — 클라이언트가 저장소를 읽은 뒤 바뀐다.
const getServerVariant = (): InstallVariant => "hidden";

export function useInstallCard() {
  const variant = useSyncExternalStore(subscribeInstall, getInstallVariant, getServerVariant);

  const promptInstall = useCallback(async () => {
    const deferred = getDeferredPrompt();
    if (!deferred) return;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") markInstalled();
    } catch (error) {
      // 프롬프트 실패 보고는 Phase 3 H(클라이언트 오류 수집) 몫이다
      console.warn("[hoondok] 설치 프롬프트 실패", error);
    } finally {
      // prompt() 는 한 번만 유효하다 — 거절했으면 일반 안내(manual)로 내려간다
      consumeDeferredPrompt();
    }
  }, []);

  const dismiss = useCallback(() => dismissInstallCard(), []);

  return { variant, promptInstall, dismiss };
}
