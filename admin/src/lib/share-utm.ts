// P2-E — 공유 URL UTM 추적 유틸 (ADR-46 §C.5.2)
// 답변 공유 링크에 ?source=share 부착 → 공유 페이지에서 진입 분석 이벤트 발송

const SHARE_SOURCE_KEY = "source";
const SHARE_SOURCE_VALUE = "share";

/**
 * 공유용 short URL 또는 답변 URL 에 `?source=share` 를 부착한다.
 * 이미 동일 파라미터가 있으면 그대로 두고, 다른 source 가 있으면 덮어쓴다.
 */
export function withShareUtm(url: string): string {
  if (!url) return url;
  try {
    // url 이 절대/상대 모두 가능하도록 base 사용
    const isAbsolute = /^https?:\/\//i.test(url);
    const base = isAbsolute
      ? undefined
      : typeof window !== "undefined"
        ? window.location.origin
        : "https://truewords.app";
    const u = new URL(url, base);
    u.searchParams.set(SHARE_SOURCE_KEY, SHARE_SOURCE_VALUE);
    // 상대 URL 로 들어왔다면 origin 을 다시 떼서 반환
    return isAbsolute ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
  } catch {
    // URL 파싱 실패 시 단순 fallback (이미 ? 가 있으면 & 사용)
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${SHARE_SOURCE_KEY}=${SHARE_SOURCE_VALUE}`;
  }
}

/** searchParams.source === "share" 인지 확인 (공유 페이지 진입 판정) */
export function isShareEntry(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
): boolean {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(SHARE_SOURCE_KEY) === SHARE_SOURCE_VALUE;
  }
  const value = searchParams[SHARE_SOURCE_KEY];
  if (Array.isArray(value)) return value.includes(SHARE_SOURCE_VALUE);
  return value === SHARE_SOURCE_VALUE;
}

/**
 * P2-E — 공유 출처 분석 이벤트 (analytics 모듈 연결 지점)
 * 현재는 dataLayer / window.gtag 가 있을 때만 발송. 없으면 silent no-op.
 */
export function trackShareEntry(meta?: { messageId?: string; referrer?: string }): void {
  if (typeof window === "undefined") return;
  const payload = {
    event: "share_entry",
    source: SHARE_SOURCE_VALUE,
    message_id: meta?.messageId,
    referrer: meta?.referrer ?? document.referrer ?? "",
    ts: new Date().toISOString(),
  };
  // dataLayer (GTM)
  const w = window as unknown as {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
  if (Array.isArray(w.dataLayer)) {
    w.dataLayer.push(payload);
  }
  // gtag (GA4)
  if (typeof w.gtag === "function") {
    w.gtag("event", "share_entry", payload);
  }
}

export const SHARE_UTM_PARAM = SHARE_SOURCE_KEY;
export const SHARE_UTM_VALUE = SHARE_SOURCE_VALUE;
