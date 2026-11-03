import { notificationsAPI } from "./api";
import { urlBase64ToUint8Array } from "./push-support";
import type { PushSubscriptionInput } from "./types";

/** 웹 루트 이전(DEC-PWA-026) 전의 SW 등록 scope. */
export const LEGACY_SW_SCOPE = "/hoondok";

/** `POST /hoondok/me/push` 의 user_agent 상한 (초과하면 422). */
const USER_AGENT_MAX = 400;

/** PushSubscription → 구독 등록 본문. endpoint·keys 는 toJSON() 그대로다. */
export function subscriptionInput(subscription: PushSubscription): PushSubscriptionInput {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    // backend 는 400자를 넘으면 422 로 돌려준다 — 진단용 값 하나 때문에 구독을 잃지 않는다.
    user_agent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, USER_AGENT_MAX),
  };
}

/**
 * 예전 /hoondok scope 등록을 정리한다. 그 등록에 알림 구독이 있으면 루트 등록으로 옮긴 뒤에만 해제한다.
 * 해제하면 그 등록의 구독도 사라지기 때문이다 — 옮기지 못하면(비로그인·권한 없음·서버 거절·iOS 가 제스처 밖 subscribe 를 막음)
 * 예전 등록을 그대로 둔다. 은퇴 스크립트(public/hoondok/sw.js)가 그 등록으로 알림을 계속 띄우고, 다음 방문에서 다시 시도한다.
 * 알림 권한은 origin 단위라 이미 허용된 기기는 새 권한 요청 없이 루트 등록에서 구독할 수 있다.
 */
export async function retireLegacyRegistration(container: ServiceWorkerContainer): Promise<void> {
  const legacyScope = new URL(LEGACY_SW_SCOPE, window.location.origin).href;
  const legacy = (await container.getRegistrations()).find((r) => r.scope === legacyScope);
  if (!legacy) return;
  const old = await legacy.pushManager?.getSubscription();
  if (old) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const config = await notificationsAPI.config();
    if (!config.enabled || !config.public_key) return;
    const root = await container.ready;
    const existing = await root.pushManager.getSubscription();
    const current =
      existing ??
      (await root.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.public_key),
      }));
    try {
      await notificationsAPI.subscribe(subscriptionInput(current));
    } catch (error) {
      // 서버가 받지 못한 새 구독은 브라우저에도 남기지 않는다(고아 구독 방지). 예전 등록은 남는다.
      if (!existing) await current.unsubscribe().catch(() => undefined);
      throw error;
    }
    // 서버 행 삭제가 실패해도 무해하다 — 해지된 endpoint 는 다음 발송에서 404/410 을 받아 서버가 지운다.
    await notificationsAPI.unsubscribe(old.endpoint).catch(() => undefined);
    await old.unsubscribe();
  }
  await legacy.unregister();
}
