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

/**
 * 인앱 브라우저(웹뷰)면 종류를, 일반 브라우저면 null. 인앱에서는 홈 화면 추가·웹 푸시가 되지 않는다.
 * 카카오톡만 외부 브라우저로 여는 스킴(`kakaotalk://web/openExternal`)이 있어 따로 구분한다.
 * UA 표식: 카카오톡 `KAKAOTALK` · 네이버 `NAVER(inapp` · 인스타그램 `Instagram` · 페이스북 `FBAN`/`FBAV`/`FB_IAB` ·
 * 라인 `Line/` · 다음 `DaumApps` · 밴드 `BAND/`. 헤드리스 Chromium·일반 사파리/크롬 UA 에는 어느 것도 없다.
 */
export function inAppBrowser(userAgent?: string): "kakaotalk" | "other" | null {
  const agent = userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (/KAKAOTALK/i.test(agent)) return "kakaotalk";
  if (/NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|(?:^|[\s;])Line\/|DaumApps|(?:^|[\s;])BAND\//.test(agent))
    return "other";
  return null;
}

/** 카카오톡 인앱에서 같은 주소를 기기 기본 브라우저로 여는 스킴 URL. */
export function kakaoOpenExternalUrl(href: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
}
