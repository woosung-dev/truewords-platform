"use client";

import { useSyncExternalStore } from "react";
import { safeLocalStorage } from "@/lib/safe-storage";

// 레드팀 시연 — 참여자 식별(이름+카테고리). localStorage 로 보존해 새로고침 시 재입력을 막는다.
// useSyncExternalStore 로 읽어 첫 렌더부터 저장값을 쓴다(effect 복원 때 게이트가 잠깐 보이던 문제 방지).
const NAME_KEY = "tw_participant_name";
const CATEGORY_KEY = "tw_participant_category";

export type Participant = { name: string; category: string };

// 저장소가 막혀도(프라이빗 모드 등) 이번 세션 동안은 진행할 수 있게 마지막 저장·삭제를 메모리에 둔다.
// undefined 면 아직 손대지 않은 상태라 localStorage 를 따른다.
let override: Participant | null | undefined;
// 같은 값이면 같은 참조를 돌려줘야 useSyncExternalStore 가 무한 렌더하지 않는다.
let snapshot: Participant | null = null;
const listeners = new Set<() => void>();

function readStored(): Participant | null {
  try {
    const store = safeLocalStorage();
    const name = store?.getItem(NAME_KEY) ?? "";
    const category = store?.getItem(CATEGORY_KEY) ?? "";
    return name && category ? { name, category } : null;
  } catch {
    return null;
  }
}

function getSnapshot(): Participant | null {
  const next = override === undefined ? readStored() : override;
  if (next?.name !== snapshot?.name || next?.category !== snapshot?.category) snapshot = next;
  return snapshot;
}

function getServerSnapshot(): Participant | null {
  return null;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function update(next: Participant | null): void {
  override = next;
  listeners.forEach((listener) => listener());
}

export function saveParticipant(participant: Participant): void {
  try {
    const store = safeLocalStorage();
    store?.setItem(NAME_KEY, participant.name);
    store?.setItem(CATEGORY_KEY, participant.category);
  } catch {
    // 저장 실패해도 이번 세션 동안은 진행.
  }
  update(participant);
}

export function clearParticipant(): void {
  try {
    const store = safeLocalStorage();
    store?.removeItem(NAME_KEY);
    store?.removeItem(CATEGORY_KEY);
  } catch {
    // 무시.
  }
  update(null);
}

/** 저장된 참여자. 서버 렌더·미입력이면 null. */
export function useParticipant(): Participant | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
