"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isIos, isStandalone } from "./platform";
import { consumeDeferredPrompt, getDeferredPrompt } from "./prompt-store";
import { dismissInstallCard, markInstalled, readInstallState, subscribeInstall } from "./storage";

export type InstallVariant = "hidden" | "ios" | "prompt" | "manual";

/**
 * 노출 정책. 기본(홈)은 저장소 3키(자격·30일 숨김·설치 기록)를 모두 본다.
 * `isAlwaysVisible`(설정 화면, PLAN-HD-002 W1-S)은 그 3키를 무시한다 — 설정은 사용자가 스스로 찾아온 자리라
 * "나중에" 로 숨긴 뒤에도 설치 방법을 볼 수 있어야 한다. standalone 판정만 그대로 남는다.
 */
export type InstallVisibility = { isAlwaysVisible?: boolean };

/**
 * 순수 함수 — 저장소 → standalone → iOS → prompt 캡처 여부 순으로 판정한다.
 * 문자열 하나를 돌려주므로 useSyncExternalStore 스냅샷이 안정적이고, navigator 는 노출 판정을 통과한 뒤에만 읽는다.
 */
export function getInstallVariant(
  now: number = Date.now(),
  { isAlwaysVisible = false }: InstallVisibility = {},
): InstallVariant {
  const { isEligible, isHidden, isInstalled } = readInstallState(now);
  if (!isAlwaysVisible && (!isEligible || isHidden || isInstalled)) return "hidden";
  // 상시 노출이어도 이미 홈 화면 앱으로 열렸으면 안내할 것이 없다 — 호출자가 한 줄 안내로 바꾼다.
  if (isStandalone()) return "hidden";
  if (isIos()) return "ios";
  return getDeferredPrompt() ? "prompt" : "manual";
}

// 서버·hydration 첫 렌더는 숨김 — 클라이언트가 저장소를 읽은 뒤 바뀐다.
const getServerVariant = (): InstallVariant => "hidden";

export function useInstallCard({ isAlwaysVisible = false }: InstallVisibility = {}) {
  // useSyncExternalStore 는 스냅샷 함수 동일성으로 구독을 다시 건다 — 옵션이 바뀔 때만 새로 만든다.
  const getSnapshot = useCallback(() => getInstallVariant(Date.now(), { isAlwaysVisible }), [isAlwaysVisible]);
  const variant = useSyncExternalStore(subscribeInstall, getSnapshot, getServerVariant);

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
