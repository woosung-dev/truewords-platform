"use client";

import Link from "next/link";
import { onboardingHref } from "@/features/identity/gate";
import { formatKoreanTime } from "../format";
import { PUSH_MESSAGES, type usePushNotifications } from "../use-push-notifications";

// 훈독하기 알림 카드 (SCR-PWA-015, PLAN-HD-006). 4종 중 이 한 종류만 실제로 켜고 끈다.
// 나머지 3종은 settings-screen 의 disabled 행 그대로다.
export type PushState = ReturnType<typeof usePushNotifications>;

const SETTINGS_PATH = "/hoondok/settings";
export const SOON = "준비 중";
export const READ_TITLE = "훈독하기";
export const READ_DESCRIPTION = "아침 훈독을 알려드려요";

/** 켤 수 없는 이유를 글자로 밝힌다 — 꺼진 토글만으로는 왜인지 알 수 없다 (DES §3.3). */
const SUPPORT_HINTS = {
  unsupported: "이 브라우저는 알림을 지원하지 않아요",
  "ios-not-installed": "홈 화면에 추가한 뒤 켤 수 있어요",
  denied: "브라우저 설정에서 알림을 허용해 주세요",
} as const;

export function ReadNotificationCard({ push }: { push: PushState }) {
  const isReady = push.support === "ready";
  const isActive = isReady && push.isSignedIn;
  // 서버 설정이 없거나(준비 중) 아직 판정 전이면 지금까지와 똑같은 "준비 중" 행이다.
  const isPending = push.support === null || push.support === "disabled";
  const hint =
    push.support && push.support in SUPPORT_HINTS ? SUPPORT_HINTS[push.support as keyof typeof SUPPORT_HINTS] : null;
  const isOn = isActive && push.prefs.read_enabled;

  return (
    <div className="card">
      <div className="st-row">
        <span className="st-row__bd">
          <b className="st-row__t">{READ_TITLE}</b>
          <span className="st-row__d">{READ_DESCRIPTION}</span>
        </span>
        <span className="st-row__side">
          {isPending && <span className="st-row__soon">{SOON}</span>}
          <button
            className="toggle"
            type="button"
            disabled={!isActive || push.isSaving}
            aria-disabled={!isActive || push.isSaving}
            aria-pressed={isOn}
            aria-label={`${READ_TITLE} 알림`}
            onClick={() => push.toggle(!push.prefs.read_enabled)}
          />
        </span>
      </div>

      {isActive && isOn ? (
        <label className="st-sub st-sub--time">
          <span className="st-sub__k">시간</span>
          <input
            className="st-sub__time"
            type="time"
            value={push.prefs.read_time}
            disabled={push.isSaving}
            onChange={(event) => {
              // 값을 지우면 "" 가 되어 서버가 422 를 낸다 — 비운 상태는 저장하지 않는다.
              if (event.target.value) push.setReadTime(event.target.value);
            }}
            aria-label={`${READ_TITLE} 알림 시간`}
          />
        </label>
      ) : (
        <button className="st-sub" type="button" disabled aria-disabled="true">
          <span className="st-sub__k">시간</span>
          <span className="st-sub__v">{formatKoreanTime(push.prefs.read_time)}</span>
        </button>
      )}

      {hint && (
        <p className="st-note" role="status">
          {hint}
        </p>
      )}
      {isReady && !push.isSignedIn && !push.isUserLoading && (
        <p className="st-note">
          <Link href={onboardingHref(SETTINGS_PATH)}>로그인하면 알림을 켤 수 있어요</Link>
        </p>
      )}
      {isActive && push.isDeviceMissing && (
        <p className="st-note" role="status">
          {PUSH_MESSAGES.otherDevice}
        </p>
      )}
      {push.message && (
        <p className="st-note" role="alert">
          {push.message}
        </p>
      )}
    </div>
  );
}
