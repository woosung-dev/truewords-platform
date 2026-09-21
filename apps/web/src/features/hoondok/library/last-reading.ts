// 이어 읽기는 기기에 마지막 volume·원문 구간만 남긴다. 본문·검색어·계정 정보는 저장하지 않는다.
const KEY = "hoondok:read:last";
const CHANGE_EVENT = "hoondok:last-reading-change";
export type LastReading = { volume: string; page: number };

export function readLastReadingRaw(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function parseLastReading(raw: string | null): LastReading | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("volume" in value) || !("page" in value)) return null;
    if (
      typeof value.volume !== "string" ||
      !value.volume.trim() ||
      typeof value.page !== "number" ||
      !Number.isSafeInteger(value.page) ||
      value.page < 1
    )
      return null;
    return { volume: value.volume, page: value.page };
  } catch {
    return null;
  }
}
export function writeLastReading(reading: LastReading): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ volume: reading.volume, page: reading.page }));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* 저장소가 차단돼도 원문 읽기는 계속한다. */
  }
}
export function subscribeLastReading(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
