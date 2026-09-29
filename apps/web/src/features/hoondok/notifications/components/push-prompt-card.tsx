"use client";

import { BellRing, Check, Smartphone } from "lucide-react";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { HoondokButton } from "@/components/hoondok";
import { INSTALL_CARD_BODY } from "@/features/hoondok/install/components/install-card";
import { inAppBrowser } from "@/features/hoondok/install/platform";
import { useInstallCard } from "@/features/hoondok/install/use-install-card";
import { useKstDate } from "@/features/hoondok/use-kst-date";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { formatKoreanTime } from "../format";
import { kstMinutesNow, nearestPreset, READ_TIME_PRESETS } from "../presets";
import { type PushPromptPlacement, pushPromptVariant } from "../push-prompt-policy";
import {
  readPushPromptDeclines,
  readPushPromptLastDeclinedOn,
  recordPushPromptDecline,
  subscribePushPrompt,
} from "../push-prompt-storage";
import { usePushNotifications } from "../use-push-notifications";

// 알림 받기 제안 카드. 노출 조건은 push-prompt-policy 한 곳이고, 여기서는 그 결과와 한 번의 "알림 받기" 뒤 상태만 그린다.
// 켜기는 설정 토글과 같은 usePushNotifications().enable — 권한 요청이 클릭 핸들러 안에서 시작된다.
// 추천 4칸 중 지금(KST)과 가장 가까운 칸을 미리 골라 두고, 버튼이 그 시각을 말한다 — 같은 PUT 에 시각을 싣는다.
// 겉(PushPromptCard)은 계정·인앱만 보고, 속(PushPromptBody)만 알림 훅을 부른다 — 비로그인·인앱 방문은 알림 요청을 만들지 않는다.
export const PUSH_PROMPT_TITLE = "매일 언제 훈독을 알려 드릴까요?";
export const PUSH_PROMPT_IOS_TITLE = "iPhone·iPad 는 홈 화면에 추가해야 알림을 받을 수 있어요";
const SETTINGS_PATH = "/hoondok/settings";
// 발송기(push_sender.TITLE_TEXT)가 보내는 제목과 같다 — 말씀 본문·신앙 맥락이 잠금 화면에 드러나지 않는다.
const PUSH_TITLE_PREVIEW = "오늘의 책갈피가 꽂혀 있어요";

const subscribeNever = () => () => {};
const isInAppSnapshot = () => inAppBrowser() !== null;

type Phase = "idle" | "requested" | "dismissed";

/** 카드가 처음 그려질 때의 KST 시각에 가장 가까운 칸 — 열어 둔 사이에 칸이 저절로 바뀌지 않는다. */
const initialReadTime = () => nearestPreset(kstMinutesNow()).time;

type PushPromptProps = { placement: PushPromptPlacement; isReadDone?: boolean };

/**
 * 겉: 로그인 확인 중·비로그인·인앱 브라우저면 아무것도 그리지 않고 알림 훅도 부르지 않는다.
 * `/hoondok/push/config`·`/hoondok/me/notifications` 는 로그인한 일반 브라우저 방문에서만 나간다.
 */
export function PushPromptCard(props: PushPromptProps) {
  const { user } = useCurrentUser();
  const isInAppBrowser = useSyncExternalStore(subscribeNever, isInAppSnapshot, () => false);
  if (!user || isInAppBrowser) return null;
  return <PushPromptBody {...props} />;
}

function PushPromptBody({ placement, isReadDone = false }: PushPromptProps) {
  const titleId = useId();
  const push = usePushNotifications();
  // 서버·hydration 첫 렌더는 null(숨김) — 클라이언트가 저장소를 읽은 뒤에 그린다.
  const declines = useSyncExternalStore(subscribePushPrompt, readPushPromptDeclines, () => null);
  const lastDeclinedOn = useSyncExternalStore(subscribePushPrompt, readPushPromptLastDeclinedOn, () => null);
  const today = useKstDate();
  // 홈 기본 설치 카드와 같은 판정 — 홈에 설치 안내가 이미 보이면 iOS 안내를 겹쳐 싣지 않는다.
  const { variant: installVariant } = useInstallCard();
  const [phase, setPhase] = useState<Phase>("idle");
  const [readTime, setReadTime] = useState(initialReadTime);

  const variant = pushPromptVariant({
    placement,
    isSignedIn: push.isSignedIn,
    isPrefsReady: push.isPrefsReady,
    isReadEnabled: push.prefs.read_enabled,
    support: push.support,
    declines,
    isDeclinedToday: lastDeclinedOn === today,
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
            {isIos ? INSTALL_CARD_BODY.ios : `잠금 화면에는 '${PUSH_TITLE_PREVIEW}' 처럼 보여요`}
          </p>
        </div>
      </div>
      {!isIos && push.support === "ready" && (
        <>
          <div className="st-presets st-presets--sm" role="radiogroup" aria-labelledby={titleId}>
            {READ_TIME_PRESETS.map((preset) => {
              const isChecked = preset.time === readTime;
              return (
                <label className="st-preset" key={preset.time} data-on={isChecked ? "" : undefined}>
                  <input
                    type="radio"
                    name={`${titleId}-time`}
                    value={preset.time}
                    checked={isChecked}
                    disabled={push.isSaving}
                    onChange={() => setReadTime(preset.time)}
                  />
                  <span className="st-preset__k">{preset.label}</span>
                  <b className="st-preset__v">{formatKoreanTime(preset.time)}</b>
                  <Check className="st-preset__ck" size={18} aria-hidden="true" />
                </label>
              );
            })}
          </div>
          <HoondokButton
            isLoading={push.isSaving}
            onClick={() => {
              setPhase("requested");
              // 권한 요청이 이 클릭 안에서 동기적으로 시작된다 (usePushNotifications.enable)
              push.enable(readTime);
            }}
          >
            {formatKoreanTime(readTime)}에 알림 받기
          </HoondokButton>
        </>
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
