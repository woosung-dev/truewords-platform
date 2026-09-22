import { isIos, isStandalone } from "../install/platform";

// 알림을 켤 수 있는지 한 줄로 답하는 순수 판정 (PLAN-HD-006). 화면은 이 값 하나로 문구·컨트롤을 고른다.
export type PushSupport =
  /** 서버에 VAPID 가 없다 — 브라우저와 무관하게 "준비 중" */
  | "disabled"
  /** 이 브라우저에 Push·Notification·ServiceWorker 가 없다 */
  | "unsupported"
  /** iOS 는 홈 화면에 추가한 뒤에만 웹 푸시를 허용한다 */
  | "ios-not-installed"
  /** 사용자가 이미 차단했다 — 다시 물을 수 없고 브라우저 설정에서만 풀린다 */
  | "denied"
  | "ready";

/**
 * 판정 순서에 뜻이 있다.
 * 1) 서버 설정이 먼저다 — 보낼 수 없는 알림은 어떤 브라우저에서도 켤 수 없으므로 "준비 중" 이 정확하다.
 * 2) 그 다음이 브라우저 능력 → iOS 설치 → 권한. 앞의 조건이 풀리지 않으면 뒤를 안내해도 소용이 없다.
 */
export function detectPushSupport(isConfigEnabled: boolean): PushSupport {
  if (!isConfigEnabled) return "disabled";
  if (typeof window === "undefined") return "unsupported";
  if (!("PushManager" in window) || !("Notification" in window) || !navigator.serviceWorker) return "unsupported";
  if (isIos() && !isStandalone()) return "ios-not-installed";
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
