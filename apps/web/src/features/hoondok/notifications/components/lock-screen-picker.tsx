"use client";

import type { LockScreenLevel } from "../types";
import type { PushState } from "./read-notification-card";
import { SOON } from "./read-notification-card";

// 잠금 화면 문구 수준 (SCR-PWA-015 F7). 기본은 신앙 맥락이 드러나지 않는 중립형이고,
// 훈독하기 알림을 켤 수 있을 때만 고를 수 있다 — 보낼 알림이 없으면 문구도 의미가 없다.
type Level = { id: LockScreenLevel; title: string; note: string };

export const LOCK_SCREEN_LEVELS: readonly Level[] = [
  { id: "neutral", title: "오늘의 읽을거리가 준비됐어요", note: "중립형 · 기본" },
  { id: "faith", title: "오늘의 말씀이 준비됐어요", note: "신앙 맥락이 드러나요 · 내가 선택" },
];

export function LockScreenPicker({ push }: { push: PushState }) {
  const isActive = push.support === "ready" && push.isSignedIn;
  const isPending = push.support === null || push.support === "disabled";

  return (
    <div className="card">
      <p className="st-lead">잠금 화면에 보일 문구예요. 기본은 내용이 드러나지 않습니다.</p>
      <div className="st-picks" role="radiogroup" aria-label="잠금 화면 문구 수준">
        {LOCK_SCREEN_LEVELS.map((level) => (
          <button
            className="st-pick"
            key={level.id}
            type="button"
            role="radio"
            aria-checked={push.prefs.lock_screen_level === level.id}
            disabled={!isActive || push.isSaving}
            aria-disabled={!isActive || push.isSaving}
            onClick={() => push.setLockScreenLevel(level.id)}
          >
            <span className="st-radio" aria-hidden="true" />
            <span className="st-pick__bd">
              <b>{level.title}</b>
              <span>{level.note}</span>
            </span>
          </button>
        ))}
      </div>
      {isPending && <p className="st-row__soon">{SOON}</p>}
    </div>
  );
}
