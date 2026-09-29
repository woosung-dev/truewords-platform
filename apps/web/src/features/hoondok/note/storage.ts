// SCR-PWA-003 "오늘의 한 줄" — 기기 전용 메모. 서버로 보내지 않고 이 브라우저 localStorage 에만 둔다
// (PLAN-HD-002 §9 2026-09-19 결정: 계정 간 동기화는 비범위).
// 키가 KST 날짜라 자정이 지나면 새 키가 되어 자연히 빈 칸이 되고, 지난 날짜 키는 지우지 않는다.
// 저장소는 없거나 던질 수 있으므로(사생활 모드·차단) 모든 접근을 try/catch 로 감싼다 — pending.ts 와 같은 규칙.

const PREFIX = "hoondok:note:";
// pending·install 의 이벤트와 분리한다 — 메모 저장이 홈 미션·설치 카드를 다시 그리지 않게.
const CHANGE_EVENT = "hoondok:note-change";

/** 한 줄 메모 최대 길이. 넘는 값은 읽을 때도 쓸 때도 잘린다. */
export const NOTE_MAX = 200;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 해당 KST 날짜(`YYYY-MM-DD`)의 메모. 없거나 읽지 못하면 빈 문자열, 길이가 깨진 값은 잘라서 돌려준다. */
export function readNote(date: string): string {
  try {
    return (storage()?.getItem(PREFIX + date) ?? "").slice(0, NOTE_MAX);
  } catch {
    return "";
  }
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // SSR·구형 환경
  }
}

/** 200자로 자르고 저장한다. 빈 문자열이면 키를 남기지 않고 지운다. */
export function writeNote(date: string, text: string): void {
  const value = text.slice(0, NOTE_MAX);
  try {
    const store = storage();
    if (value) store?.setItem(PREFIX + date, value);
    else store?.removeItem(PREFIX + date);
  } catch {
    // 저장 실패해도 화면의 입력값은 그대로 둔다
  }
  notify();
}

export type DeviceNote = { date: string; text: string };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** SSR·저장소 없음의 스냅샷. useSyncExternalStore 가 같은 참조를 봐야 하므로 상수 하나를 돌려쓴다. */
export const EMPTY_NOTES: readonly DeviceNote[] = [];

// 저장된 내용이 그대로면 같은 배열을 돌려줘야 useSyncExternalStore 가 무한히 다시 그리지 않는다.
let notesSnapshot: { signature: string; items: readonly DeviceNote[] } = { signature: "[]", items: EMPTY_NOTES };

/** 이 기기에 남은 한 줄 전부, 날짜 최신순. 빈 값·날짜가 아닌 키는 건너뛰고 읽지 못하면 빈 목록이다. */
export function readAllNotes(): readonly DeviceNote[] {
  try {
    const store = storage();
    if (!store) return EMPTY_NOTES;
    const found: DeviceNote[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      const date = key?.startsWith(PREFIX) ? key.slice(PREFIX.length) : "";
      if (!DATE_KEY.test(date)) continue;
      const text = (store.getItem(PREFIX + date) ?? "").slice(0, NOTE_MAX);
      if (text.trim()) found.push({ date, text });
    }
    found.sort((a, b) => b.date.localeCompare(a.date));
    const signature = JSON.stringify(found);
    if (signature !== notesSnapshot.signature) notesSnapshot = { signature, items: found };
    return notesSnapshot.items;
  } catch {
    return EMPTY_NOTES;
  }
}

/** useSyncExternalStore 용 구독 — 같은 탭의 write 와 다른 탭의 storage 이벤트. */
export function subscribeNote(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
