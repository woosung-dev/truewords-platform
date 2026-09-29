"use client";

import { BellRing, Check } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { onboardingHref } from "@/features/identity/gate";
import { formatKoreanTime } from "../format";
import { isPresetTime, READ_TIME_PRESETS } from "../presets";
import { PUSH_MESSAGES, type usePushNotifications } from "../use-push-notifications";

// 훈독하기 알림 카드 (SCR-PWA-015, PLAN-HD-006). 실제로 켜고 끄는 알림은 이 한 종류뿐이다.
// 시각은 추천 4칸 + 직접 정하기로 고르고, 고르는 즉시 PUT 한 번으로 저장한다(따로 저장 버튼이 없다).
export type PushState = ReturnType<typeof usePushNotifications>;

const SETTINGS_PATH = "/hoondok/settings";
export const SOON = "준비 중";
export const READ_TITLE = "훈독하기";
export const READ_DESCRIPTION = "정한 시간에 하루 한 번 알려드려요";
export const READ_TIME_QUESTION = "언제 알려 드릴까요?";
export const SAVED_TEXT = "저장했어요";

/** 켤 수 없는 이유를 글자로 밝힌다 — 꺼진 토글만으로는 왜인지 알 수 없다 (DES §3.3). */
const SUPPORT_HINTS = {
  unsupported: "이 브라우저는 알림을 지원하지 않아요",
  "ios-not-installed": "홈 화면에 추가한 뒤 켤 수 있어요",
  denied: "브라우저 설정에서 알림을 허용해 주세요",
} as const;

export function ReadNotificationCard({ push }: { push: PushState }) {
  const nameId = useId();
  const isReady = push.support === "ready";
  const isActive = isReady && push.isSignedIn;
  // 서버 설정이 없거나(준비 중) 아직 판정 전이면 지금까지와 똑같은 "준비 중" 행이다.
  const isPending = push.support === null || push.support === "disabled";
  const hint =
    push.support && push.support in SUPPORT_HINTS ? SUPPORT_HINTS[push.support as keyof typeof SUPPORT_HINTS] : null;
  const isOn = isActive && push.prefs.read_enabled;

  // 이 화면에서 마지막으로 누른 것과 고른 시각. 저장 중에는 고른 칸을 먼저 보여 주고(되튀지 않게),
  // 저장이 끝나면 서버 값이 기준이다 — 실패하면 원래 칸으로 돌아간다.
  const [lastAction, setLastAction] = useState<"toggle" | "time" | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [isCustomOpen, setCustomOpen] = useState(false);
  const isTimeSaving = push.isSaving && lastAction === "time";
  const readTime = isTimeSaving && picked ? picked : push.prefs.read_time;
  const isCustom = isCustomOpen || !isPresetTime(readTime);
  const isSaved = lastAction === "time" && !push.isSaving && !push.message && picked === push.prefs.read_time;

  function saveTime(time: string) {
    setLastAction("time");
    setPicked(time);
    push.setReadTime(time);
  }

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
            onClick={() => {
              setLastAction("toggle");
              push.toggle(!push.prefs.read_enabled);
            }}
          />
        </span>
      </div>

      {isActive ? (
        <div className="st-time">
          {/* 꺼져 있거나 켜고 끄는 중이면 칸 전체가 비활성이다. 시각 저장 중에는 막지 않는다 —
              막으면 화살표 키로 옮기던 포커스가 사라진다(저장은 훅이 한 줄로 세운다). */}
          <fieldset className="st-time__fs" disabled={!isOn || (push.isSaving && lastAction === "toggle")}>
            <legend className="st-time__q">{READ_TIME_QUESTION}</legend>
            <div className="st-presets">
              {READ_TIME_PRESETS.map((preset) => {
                const isChecked = !isCustom && readTime === preset.time;
                return (
                  <label className="st-preset" key={preset.time} data-on={isChecked ? "" : undefined}>
                    <input
                      type="radio"
                      name={nameId}
                      value={preset.time}
                      checked={isChecked}
                      onChange={() => {
                        setCustomOpen(false);
                        if (preset.time !== readTime) saveTime(preset.time);
                      }}
                    />
                    <span className="st-preset__k">{preset.label}</span>
                    <b className="st-preset__v">{formatKoreanTime(preset.time)}</b>
                    <Check className="st-preset__ck" size={18} aria-hidden="true" />
                  </label>
                );
              })}
            </div>
            <label className="st-preset st-preset--custom" data-on={isCustom ? "" : undefined}>
              <input
                type="radio"
                name={nameId}
                value="custom"
                checked={isCustom}
                onChange={() => setCustomOpen(true)}
              />
              <span className="st-preset__k">직접 정하기</span>
              {isCustom && <span className="st-preset__v">{formatKoreanTime(readTime)}</span>}
            </label>
            {isCustom && (
              <label className="st-custom">
                <span className="st-custom__k">시간</span>
                <input
                  className="st-custom__in"
                  type="time"
                  value={readTime}
                  onChange={(event) => {
                    // 값을 지우면 "" 가 되어 서버가 422 를 낸다 — 비운 상태는 저장하지 않는다.
                    const { value } = event.target;
                    if (value && value !== readTime) saveTime(value);
                  }}
                  aria-label={`${READ_TITLE} 알림 시간`}
                />
              </label>
            )}
          </fieldset>

          {isOn && (
            <p className="st-sum" role="status">
              <BellRing className="st-sum__ic" size={18} aria-hidden="true" />
              <span>
                <b>매일 {formatKoreanTime(readTime)}</b>에 알려드려요
                {isSaved && (
                  <span className="st-sum__saved">
                    <Check size={14} aria-hidden="true" />
                    {SAVED_TEXT}
                  </span>
                )}
                <small className="st-sum__sub">그날 훈독을 마쳤으면 알리지 않아요</small>
              </span>
            </p>
          )}
        </div>
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
