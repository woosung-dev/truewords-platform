import { inAppBrowser, isIos, isStandalone } from "../install/platform";

// 알림을 켤 수 있는지 한 줄로 답하는 순수 판정 (PLAN-HD-006). 화면은 이 값 하나로 문구·컨트롤을 고른다.
export type PushSupport =
  /** 서버에 VAPID 가 없다 — 브라우저와 무관하게 "준비 중" */
  | "disabled"
  /** 이 브라우저에 Push·Notification·ServiceWorker 가 없다 · 카카오톡 등 인앱 브라우저(웹뷰) */
  | "unsupported"
  /** iOS 는 홈 화면에 추가한 뒤에만 웹 푸시를 허용한다 */
  | "ios-not-installed"
  /** 사용자가 이미 차단했다 — 다시 물을 수 없고 브라우저 설정에서만 풀린다 */
  | "denied"
  | "ready";

/**
 * 판정 순서에 뜻이 있다.
 * 1) 서버 설정이 먼저다 — 보낼 수 없는 알림은 어떤 브라우저에서도 켤 수 없으므로 "준비 중" 이 정확하다.
 * 2) 인앱 브라우저(카카오톡 등)는 홈 화면에 추가해도 푸시가 되지 않는다 — iOS 설치 안내보다 먼저 "미지원" 으로 끊는다.
 *    iPhone 카카오톡에서 "홈 화면에 추가한 뒤 켤 수 있어요" 는 틀린 안내다(바깥 브라우저로 여는 배너가 따로 있다).
 * 3) 그 다음이 iOS 설치 → 브라우저 능력 → 권한. iOS 사파리 탭에는 PushManager·Notification 이 아예 없어서
 *    능력을 먼저 보면 "미지원" 으로 끝나 설치 안내에 닿지 못한다 — 홈 화면에 추가하면 생기므로 설치가 먼저다.
 */
export function detectPushSupport(isConfigEnabled: boolean): PushSupport {
  if (!isConfigEnabled) return "disabled";
  if (typeof window === "undefined") return "unsupported";
  if (inAppBrowser() !== null) return "unsupported";
  if (isIos() && !isStandalone()) return "ios-not-installed";
  if (!("PushManager" in window) || !("Notification" in window) || !navigator.serviceWorker) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ready";
}

/** VAPID 공개키(base64url) → subscribe 가 받는 바이트 배열. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
