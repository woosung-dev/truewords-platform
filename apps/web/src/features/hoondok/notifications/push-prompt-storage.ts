// 알림 받기 제안 카드의 "나중에" 횟수 (localStorage 한 키). install/storage.ts 와 같은 규칙 —
// 저장소는 없거나 던질 수 있으므로 전부 try/catch 이고, 못 읽으면 0(처음 보는 사람)으로 본다.
const KEY = "hoondok:push-prompt";
const CHANGE_EVENT = "hoondok:push-prompt-change";

type Stored = { declines: number };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 값이 깨졌으면(JSON 아님·음수·소수) 0 으로 본다 — 카드가 한 번 더 보이는 쪽이 영영 안 보이는 쪽보다 낫다. */
export function readPushPromptDeclines(): number {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(KEY) ?? "null");
    const declines = typeof parsed === "object" && parsed !== null ? (parsed as { declines?: unknown }).declines : 0;
    return typeof declines === "number" && Number.isInteger(declines) && declines > 0 ? declines : 0;
  } catch {
    return 0;
  }
}

/** "나중에" 한 번. 저장에 실패해도 호출자가 그 자리 카드를 숨긴다. */
export function recordPushPromptDecline(): void {
  try {
    const next: Stored = { declines: readPushPromptDeclines() + 1 };
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장 실패해도 화면 상태는 유지한다
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // SSR·구형 환경
  }
}

/** useSyncExternalStore 용 구독 — 같은 탭의 변경 이벤트와 다른 탭의 storage 이벤트. */
export function subscribePushPrompt(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
