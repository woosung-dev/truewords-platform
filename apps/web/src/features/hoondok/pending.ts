// 비로그인 상태의 "완료" 체크 (AC-016-02). localStorage 에 KST 날짜와 함께 두고 로그인 후 당일분만 소급한다.
// 저장소는 없거나 던질 수 있으므로(사생활 모드·차단) 모든 접근을 try/catch 로 감싼다.
import type { MissionKind } from "./missions-api";
import { formatKstDate } from "./today";

const PREFIX = "hoondok:pending:";
const CHANGE_EVENT = "hoondok:pending-change";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 오늘(KST) 키가 있으면 true. 다른 날짜 키는 자정이 지난 것이라 지우고 false. */
export function readPending(kind: MissionKind, todayIso: string = formatKstDate().iso): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const stored = store.getItem(PREFIX + kind);
    if (stored === todayIso) return true;
    if (stored) store.removeItem(PREFIX + kind);
  } catch {
    // 읽기 실패는 "없음" 으로 본다
  }
  return false;
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // SSR·구형 환경
  }
}

export function writePending(kind: MissionKind, todayIso: string = formatKstDate().iso): void {
  try {
    storage()?.setItem(PREFIX + kind, todayIso);
  } catch {
    // 저장 실패해도 화면 상태는 유지한다
  }
  notify();
}

export function clearPending(kind: MissionKind): void {
  try {
    storage()?.removeItem(PREFIX + kind);
  } catch {
    // 무시
  }
  notify();
}

/** useSyncExternalStore 용 구독 — 같은 탭의 write/clear 와 다른 탭의 storage 이벤트. */
export function subscribePending(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
