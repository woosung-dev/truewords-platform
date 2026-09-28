import type { PushSupport } from "./push-support";

// 알림 받기 제안 카드의 노출 정책 (순수 함수). 알림은 기본으로 켜도록 권하되, OS 규칙상 "허용" 한 번은 사용자가 눌러야 하므로
// 기본 선택이 "알림 받기" 인 한 장짜리 제안을 두 자리에서만 보인다 — 가입 직후 홈, 오늘 훈독을 마친 뒤.
// "나중에" 두 번이면 더 묻지 않고 설정 화면에서만 켠다.

/** home = 홈 상단, after-read = 훈독하기 완료 카드 아래. */
export type PushPromptPlacement = "home" | "after-read";

/** ready = 알림 받기 버튼 · ios = iPhone 은 홈 화면에 추가하라는 안내(알림을 켤 수 없다) · hidden = 그리지 않는다 */
export type PushPromptVariant = "hidden" | "ready" | "ios";

/** "나중에" 를 이 횟수만큼 누르면 어느 자리에서도 더 묻지 않는다. 홈은 첫 번째 "나중에" 에서 이미 멈춘다. */
export const PUSH_PROMPT_MAX_DECLINES = 2;

export type PushPromptInput = {
  placement: PushPromptPlacement;
  isSignedIn: boolean;
  /** 서버 설정을 읽었는가. 읽기 전 기본값(꺼짐)만 보고 그리면 이미 켠 사람에게 카드가 번쩍인다. */
  isPrefsReady: boolean;
  isReadEnabled: boolean;
  /** null = 서버 설정(VAPID) 확인 중 */
  support: PushSupport | null;
  /** 카카오톡 등 인앱 브라우저 — 설치·푸시가 안 되고, 바깥 브라우저로 여는 배너가 따로 있다 */
  isInAppBrowser: boolean;
  /** "나중에" 횟수. null = 저장소를 아직 읽지 않음(SSR·hydration 첫 렌더) */
  declines: number | null;
  /** 오늘 훈독을 마쳤는가 (after-read 자리의 조건) */
  isReadDone: boolean;
  /** 같은 화면에 설치 안내 카드가 이미 보이는가 (home 자리). iOS 설치 안내가 두 장 겹치지 않게 한다 */
  isInstallCardVisible: boolean;
};

export function pushPromptVariant(input: PushPromptInput): PushPromptVariant {
  if (!input.isSignedIn || !input.isPrefsReady || input.isReadEnabled) return "hidden";
  if (input.isInAppBrowser || input.declines === null) return "hidden";
  // disabled(준비 중)·unsupported·denied 는 이 카드로 풀 수 없다. denied 는 브라우저 설정에서만 풀린다.
  if (input.support !== "ready" && input.support !== "ios-not-installed") return "hidden";

  const isPlacementOpen =
    input.placement === "home" ? input.declines === 0 : input.isReadDone && input.declines < PUSH_PROMPT_MAX_DECLINES;
  if (!isPlacementOpen) return "hidden";

  if (input.support === "ios-not-installed") {
    return input.placement === "home" && input.isInstallCardVisible ? "hidden" : "ios";
  }
  return "ready";
}
