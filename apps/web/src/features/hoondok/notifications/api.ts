import { createApiClient } from "@truewords/api-client-ts";
import { hoondokFetch } from "../observability/report";
import type {
  NotificationPrefs,
  NotificationPrefsInput,
  PushConfig,
  PushSubscriptionCreated,
  PushSubscriptionInput,
} from "./types";

// 알림 설정·구독 API (PLAN-HD-006). 브라우저에서 쿠키와 함께 /api/backend 프록시로 간다 —
// X-Requested-With 와 credentials 는 createApiClient 의 transport 가 붙인다.
const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });

export const notificationsAPI = {
  config: () => request<PushConfig>("/hoondok/push/config"),
  prefs: () => request<NotificationPrefs>("/hoondok/me/notifications"),
  savePrefs: (body: NotificationPrefsInput) =>
    request<NotificationPrefs>("/hoondok/me/notifications", { method: "PUT", body: JSON.stringify(body) }),
  subscribe: (body: PushSubscriptionInput) =>
    request<PushSubscriptionCreated>("/hoondok/me/push", { method: "POST", body: JSON.stringify(body) }),
  // endpoint 는 URL 이라 쿼리에 넣기 전에 반드시 인코딩한다(그대로 붙이면 ?·& 에서 잘린다).
  unsubscribe: (endpoint: string) =>
    request<Record<string, never>>(`/hoondok/me/push?endpoint=${encodeURIComponent(endpoint)}`, { method: "DELETE" }),
};
