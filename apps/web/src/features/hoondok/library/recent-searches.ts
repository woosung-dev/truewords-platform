// SCR-PWA-008 최근 검색 — 기기 전용 저장소 (PLAN-HD-002 W3-L).
// 검색 자체가 준비 중이라 질의는 서버로 가지 않는다. 입력한 말만 이 브라우저 localStorage 한 키에 남는다.
// 저장소는 없거나 던질 수 있으므로(사생활 모드·차단) 모든 접근을 try/catch 로 감싼다 — ask/storage.ts 와 같은 규칙.

const KEY = "hoondok:search:recent";
// 다른 화면(질문 기록·오늘의 한 줄)의 이벤트와 분리한다.
const CHANGE_EVENT = "hoondok:search-recent-change";

/** 보관 상한. 넘으면 오래된 것부터 버린다(배열 앞이 최신). */
export const RECENT_MAX = 8;

/** SSR·저장소 없음의 스냅샷. useSyncExternalStore 가 같은 참조를 봐야 한다. */
export const EMPTY_RECENT: readonly string[] = [];

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  try {
    return storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function parse(raw: string | null): string[] {
  if (!raw) return EMPTY_RECENT as string[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_RECENT as string[];
    // 깨진 항목이 섞여도 화면이 죽지 않게 문자열만 남긴다.
    return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, RECENT_MAX);
  } catch {
    return EMPTY_RECENT as string[];
  }
}

// 저장된 문자열이 그대로면 같은 배열을 돌려줘야 useSyncExternalStore 가 무한 렌더하지 않는다.
let snapshot: { raw: string | null; items: string[] } = { raw: null, items: EMPTY_RECENT as string[] };

export function readRecentSearches(): string[] {
  const raw = readRaw();
  if (raw !== snapshot.raw) snapshot = { raw, items: parse(raw) };
  return snapshot.items;
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // SSR·구형 환경
  }
}

function writeAll(items: string[]): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(items.slice(0, RECENT_MAX)));
  } catch {
    // 저장 실패(용량 초과·차단)해도 화면의 값은 그대로 둔다
  }
  notify();
}

/** 검색어를 맨 앞에 넣는다. 같은 말은 한 번만 남고 빈 말은 무시한다. */
export function appendRecentSearch(query: string): void {
  const text = query.trim();
  if (!text) return;
  writeAll([text, ...readRecentSearches().filter((old) => old !== text)]);
}

export function clearRecentSearches(): void {
  writeAll([]);
}

/** useSyncExternalStore 용 구독 — 같은 탭의 write 와 다른 탭의 storage 이벤트. */
export function subscribeRecentSearches(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
