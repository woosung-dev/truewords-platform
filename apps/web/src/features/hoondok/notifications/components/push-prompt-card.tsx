"use client";

import { BellRing, Smartphone } from "lucide-react";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { HoondokButton } from "@/components/hoondok";
import { INSTALL_CARD_BODY } from "@/features/hoondok/install/components/install-card";
import { inAppBrowser } from "@/features/hoondok/install/platform";
import { useInstallCard } from "@/features/hoondok/install/use-install-card";
import { formatKoreanTime } from "../format";
import { type PushPromptPlacement, pushPromptVariant } from "../push-prompt-policy";
import { readPushPromptDeclines, recordPushPromptDecline, subscribePushPrompt } from "../push-prompt-storage";
import { usePushNotifications } from "../use-push-notifications";
import { LOCK_SCREEN_LEVELS } from "./lock-screen-picker";

// 알림 받기 제안 카드. 노출 조건은 push-prompt-policy 한 곳이고, 여기서는 그 결과와 한 번의 "알림 받기" 뒤 상태만 그린다.
// 켜기는 설정 토글과 같은 usePushNotifications().enable — 권한 요청이 클릭 핸들러 안에서 시작된다.
export const PUSH_PROMPT_TITLE = "매일 아침 훈독 시간을 알려 드릴까요?";
export const PUSH_PROMPT_IOS_TITLE = "iPhone 은 홈 화면에 추가해야 알림을 받을 수 있어요";
const SETTINGS_PATH = "/hoondok/settings";

const subscribeNever = () => () => {};
const isInAppSnapshot = () => inAppBrowser() !== null;

type Phase = "idle" | "requested" | "dismissed";

export function PushPromptCard({
  placement,
  isReadDone = false,
}: {
  placement: PushPromptPlacement;
  isReadDone?: boolean;
}) {
  const titleId = useId();
  const push = usePushNotifications();
  // 서버·hydration 첫 렌더는 null(숨김) — 클라이언트가 저장소를 읽은 뒤에 그린다.
  const declines = useSyncExternalStore(subscribePushPrompt, readPushPromptDeclines, () => null);
  const isInAppBrowser = useSyncExternalStore(subscribeNever, isInAppSnapshot, () => false);
  // 홈 기본 설치 카드와 같은 판정 — 홈에 설치 안내가 이미 보이면 iOS 안내를 겹쳐 싣지 않는다.
  const { variant: installVariant } = useInstallCard();
  const [phase, setPhase] = useState<Phase>("idle");

  const variant = pushPromptVariant({
    placement,
    isSignedIn: push.isSignedIn,
    isPrefsReady: push.isPrefsReady,
    isReadEnabled: push.prefs.read_enabled,
    support: push.support,
    isInAppBrowser,
    declines,
    isReadDone,
    isInstallCardVisible: installVariant !== "hidden",
  });

  // "알림 받기" 를 누른 뒤에는 정책이 숨김으로 바뀌어도(켜짐·권한 거절) 결과를 이 자리에서 알려야 한다.
  if (phase === "dismissed" || (phase === "idle" && variant === "hidden")) return null;

  function later() {
    recordPushPromptDecline();
    setPhase("dismissed");
  }

  if (phase === "requested" && push.prefs.read_enabled) {
    // 오늘 이미 읽었으면 발송기가 오늘은 건너뛴다 — 그때만 "내일" 이 정확하다.
    const when = `${isReadDone ? "내일" : "매일"} ${formatKoreanTime(push.prefs.read_time)}`;
    return (
      <section className="card install push-prompt" aria-labelledby={titleId} role="status">
        <div className="install__hd">
          <span className="install__ic push-prompt__ic--on" aria-hidden="true">
            <BellRing size={24} />
          </span>
          <div className="install__bd">
            <h2 className="install__title" id={titleId}>
              {when}에 알려 드릴게요
            </h2>
            <Link className="push-prompt__link" href={SETTINGS_PATH}>
              시각은 설정에서 바꿀 수 있어요
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // 정책이 보여 준 자리라면 ios 변형 ⇔ ios-not-installed 다 (권한을 물을 수 없어 "알림 받기" 가 없다).
  const isIos = push.support === "ios-not-installed";
  const lockScreenTitle =
    LOCK_SCREEN_LEVELS.find((level) => level.id === push.prefs.lock_screen_level)?.title ?? LOCK_SCREEN_LEVELS[0].title;

  return (
    <section className="card install push-prompt" aria-labelledby={titleId}>
      <div className="install__hd">
        <span className="install__ic" aria-hidden="true">
          {isIos ? <Smartphone size={24} /> : <BellRing size={24} />}
        </span>
        <div className="install__bd">
          <h2 className="install__title" id={titleId}>
            {isIos ? PUSH_PROMPT_IOS_TITLE : PUSH_PROMPT_TITLE}
          </h2>
          <p className="install__body">
            {isIos ? INSTALL_CARD_BODY.ios : `잠금 화면에는 '${lockScreenTitle}' 처럼 보여요`}
          </p>
        </div>
      </div>
      {!isIos && push.support === "ready" && (
        <HoondokButton
          isLoading={push.isSaving}
          onClick={() => {
            setPhase("requested");
            // 권한 요청이 이 클릭 안에서 동기적으로 시작된다 (usePushNotifications.enable)
            push.enable();
          }}
        >
          알림 받기
        </HoondokButton>
      )}
      {push.message && (
        <p className="st-note" role="alert">
          {push.message}
        </p>
      )}
      <button className="push-prompt__later" type="button" onClick={later} disabled={push.isSaving}>
        나중에
      </button>
    </section>
  );
}
