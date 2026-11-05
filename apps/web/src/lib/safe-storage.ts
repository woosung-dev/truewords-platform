/** 브라우저 localStorage. 서버 렌더이거나 접근이 막혔으면(프라이빗 모드·차단된 사이트 데이터) null. */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
