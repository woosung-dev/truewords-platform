import type { PushSupport } from "./push-support";

// 알림 받기 제안 카드의 노출 정책 (순수 함수). 알림은 기본으로 켜도록 권하되, OS 규칙상 "허용" 한 번은 사용자가 눌러야 하므로
// 기본 선택이 "알림 받기" 인 한 장짜리 제안을 두 자리에서만 보인다 — 홈(가입 직후 첫 방문 · 오늘 마친 뒤), 훈독하기 완료 아래.
// "나중에" 두 번이면 더 묻지 않고 설정 화면에서만 켠다. 두 번째 기회는 첫 "나중에" 다음 날부터다.
// 인앱 브라우저는 여기서 따로 보지 않는다 — detectPushSupport 가 "unsupported" 로 돌려주고, 카드 겉 컴포넌트가 먼저 거른다.

/** home = 홈 "오늘의 실천"·"이번 주" 아래, after-read = 훈독하기 완료 카드 아래. */
export type PushPromptPlacement = "home" | "after-read";

/** ready = 알림 받기 버튼 · ios = iPhone·iPad 는 홈 화면에 추가하라는 안내(알림을 켤 수 없다) · hidden = 그리지 않는다 */
export type PushPromptVariant = "hidden" | "ready" | "ios";

/** "나중에" 를 이 횟수만큼 누르면 어느 자리에서도 더 묻지 않는다. */
export const PUSH_PROMPT_MAX_DECLINES = 2;

export type PushPromptInput = {
  placement: PushPromptPlacement;
  isSignedIn: boolean;
  /** 서버 설정을 읽었는가. 읽기 전 기본값(꺼짐)만 보고 그리면 이미 켠 사람에게 카드가 번쩍인다. */
  isPrefsReady: boolean;
  isReadEnabled: boolean;
  /** null = 서버 설정(VAPID) 확인 중 */
  support: PushSupport | null;
  /** "나중에" 횟수. null = 저장소를 아직 읽지 않음(SSR·hydration 첫 렌더) */
  declines: number | null;
  /** 마지막 "나중에" 가 오늘(KST)인가. 옛 저장값처럼 날짜가 없으면 false */
  isDeclinedToday: boolean;
  /** 오늘 훈독을 마쳤는가 — 홈 미션 체크의 즉시 완료도 포함한다 */
  isReadDone: boolean;
  /** 같은 화면에 설치 안내 카드가 이미 보이는가 (home 자리). iOS 설치 안내가 두 장 겹치지 않게 한다 */
  isInstallCardVisible: boolean;
};

export function pushPromptVariant(input: PushPromptInput): PushPromptVariant {
  if (!input.isSignedIn || !input.isPrefsReady || input.isReadEnabled) return "hidden";
  if (input.declines === null) return "hidden";
  // disabled(준비 중)·unsupported·denied 는 이 카드로 풀 수 없다. denied 는 브라우저 설정에서만 풀린다.
  if (input.support !== "ready" && input.support !== "ios-not-installed") return "hidden";

  // 첫 기회: 홈 첫 방문(가입 직후), 또는 홈을 거치지 않고 오늘 읽은 뒤 훈독하기 완료 아래.
  const isFirstChance = input.declines === 0 && (input.placement === "home" || input.isReadDone);
  // 두 번째 기회: "오늘 읽은 뒤" — 훈독하기 화면에서 마쳤든 홈 미션 체크로 마쳤든 같다. 단 첫 "나중에" 가 오늘이면
  // 열지 않는다 — /read 에서 "나중에" 를 누르고 홈으로 돌아오자마자 같은 질문을 다시 받지 않게.
  const isSecondChance =
    input.declines > 0 && input.declines < PUSH_PROMPT_MAX_DECLINES && input.isReadDone && !input.isDeclinedToday;
  if (!isFirstChance && !isSecondChance) return "hidden";

  if (input.support === "ios-not-installed") {
    return input.placement === "home" && input.isInstallCardVisible ? "hidden" : "ios";
  }
  return "ready";
}
