// 설치 안내 분기용 플랫폼 판정 (PLAN-HD-001 Phase 3 E). 브라우저에서만 부른다 — 호출자가 typeof window 를 먼저 본다.

/** 이미 홈 화면 앱으로 열렸으면 true (안드로이드 display-mode · iOS navigator.standalone). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia 미구현 환경
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone·iPad(iPadOS 13+ 는 Macintosh UA + 터치)면 true. iOS 의 Chrome·Firefox 도 공유 시트로만 설치하므로 같은 분기다. */
export function isIos(userAgent?: string, maxTouchPoints?: number): boolean {
  if (typeof navigator === "undefined") return false;
  const agent = userAgent ?? navigator.userAgent;
  const touch = maxTouchPoints ?? navigator.maxTouchPoints ?? 0;
  if (/iPhone|iPad|iPod/.test(agent)) return true;
  return /Macintosh/.test(agent) && touch > 1;
}
