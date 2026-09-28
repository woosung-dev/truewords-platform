// 오늘 받은 책갈피 기록 (PLAN-HD-012). 비로그인은 localStorage 에 "KST 날짜|카드 id" 를 두고 로그인 뒤 당일분만 소급한다
// (홈 완료 체크 pending.ts 와 같은 규칙). 로그인 사용자도 같은 기기의 재방문 모션을 막으려 계정 키에 같은 값을 둔다.
// 저장소는 없거나 던질 수 있으므로(사생활 모드·차단) 모든 접근을 try/catch 로 감싼다.
import type { CardReceiptItem } from "./api";

const PREFIX = "hoondok:card:received";
const CHANGE_EVENT = "hoondok:card-change";

export type LocalReceipt = { date: string; cardId: string };

function key(userId?: string): string {
  return userId ? `${PREFIX}:${userId}` : PREFIX;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 오늘(KST) 기록만 돌려준다. 다른 날짜 기록은 자정이 지난 것이라 지우고 null. */
export function readLocalReceipt(today: string, userId?: string): LocalReceipt | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key(userId));
    if (!raw) return null;
    const [date, cardId] = raw.split("|", 2);
    if (date === today && cardId) return { date, cardId };
    store.removeItem(key(userId));
  } catch {
    // 읽기 실패는 "없음" 으로 본다
  }
  return null;
}

export function writeLocalReceipt(receipt: LocalReceipt, userId?: string): void {
  try {
    storage()?.setItem(key(userId), `${receipt.date}|${receipt.cardId}`);
  } catch {
    // 저장 실패해도 화면은 그대로 둔다 (다음 방문에 모션이 한 번 더 나올 뿐)
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // SSR
  }
}

export function clearLocalReceipt(userId?: string): void {
  try {
    storage()?.removeItem(key(userId));
  } catch {
    // 무시
  }
}

/** useSyncExternalStore 용 구독 — 같은 탭 write 와 다른 탭 storage 이벤트. */
export function subscribeLocalReceipt(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * 오늘 카드를 이미 받았는가.
 * - 로그인: 서버 receipt 에 오늘 카드가 오늘(KST) 날짜로 있으면 받음. 풀이 돌아 예전에 받은 카드가 다시 온 날은
 *   received_on 이 과거라 서버만으로는 알 수 없으므로, 이 기기에서 오늘 받은 계정 기록도 함께 본다.
 * - 비로그인: 이 기기의 오늘 기록(날짜·카드가 모두 같을 때)만 본다.
 */
export function isReceivedToday({
  today,
  cardId,
  localReceipt,
  serverItems,
}: {
  today: string;
  cardId: string;
  localReceipt: LocalReceipt | null;
  serverItems?: readonly CardReceiptItem[] | null;
}): boolean {
  if (localReceipt && localReceipt.date === today && localReceipt.cardId === cardId) return true;
  return Boolean(serverItems?.some((item) => item.card.id === cardId && item.received_on === today));
}
