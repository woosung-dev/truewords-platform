"use client";

import { useEffect, useSyncExternalStore } from "react";

// 하단 안내 자리 상태. 화면은 안내를 그리지 않고 "지금 어떤 순간인지" 신호만 보낸다 — 무엇을 보일지는 layout 의
// HoondokNoticeSlot 한 곳이 정한다. 화면을 옮겨도(iPhone 은 Safari 메뉴를 오가도) 펼침이 남아야 해서 모듈 상태로 둔다.

/** home = 홈 화면에 있음, after-read = 훈독하기에서 방금 마침. isReadDone 은 홈 미션 체크의 즉시 완료도 포함한다. */
export type NoticeSignal = { placement: "home" | "after-read"; isReadDone: boolean };
export type NoticeKind = "install" | "push";
export type NoticeState = { signal: NoticeSignal | null; expanded: NoticeKind | null };

const INITIAL: NoticeState = { signal: null, expanded: null };
let state: NoticeState = INITIAL;
const listeners = new Set<() => void>();

function update(next: Partial<NoticeState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 안내 자리를 그 자리에서 펼친다 (iPhone 설치 단계 · 알림 시각 고르기). */
export const expandNotice = (kind: NoticeKind): void => update({ expanded: kind });
export const collapseNotice = (): void => update({ expanded: null });

/**
 * 화면이 부르는 유일한 API. 마운트된 동안 신호를 걸고, 내려가면 자기 신호만 거둔다.
 * null 이면 아무 신호도 보내지 않는다(예: 아직 읽는 중).
 */
export function useNoticeSignal(signal: NoticeSignal | null): void {
  const placement = signal?.placement;
  const isReadDone = signal?.isReadDone ?? false;
  useEffect(() => {
    if (!placement) return;
    const mine: NoticeSignal = { placement, isReadDone };
    update({ signal: mine });
    return () => {
      if (state.signal === mine) update({ signal: null });
    };
  }, [placement, isReadDone]);
}

export function useNoticeState(): NoticeState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );
}
