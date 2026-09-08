/* 훈독 PWA 최소 서비스워커 (PRD-HOONDOK-001 · REQ-PWA-009/010)
 * - 앱 셸(/hoondok)과 아이콘만 프리캐시한다.
 * - 페이지 이동은 네트워크 우선, 실패 시 캐시된 /hoondok 을 보여 준다.
 * - /api/, /admin/, 질문·메모·인증 응답은 절대 캐시하지 않는다.
 * - push: payload 가 없거나 신뢰할 수 없으면 중립 문구만 표시한다.
 * - 서버 VAPID 발송·구독 API 는 이 PR 의 범위가 아니다 (M5 backend).
 */
const VERSION = "hoondok-shell-v1";
const SHELL = ["/hoondok", "/icons/hoondok.svg", "/icons/hoondok-192.png", "/icons/hoondok-512.png"];
const NEVER_CACHE = /^\/(api|admin|login|history)(\/|$)|^\/$/;
const NEUTRAL_TITLE = "훈독";
const NEUTRAL_BODY = "오늘의 읽을거리가 준비됐어요";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || NEVER_CACHE.test(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/hoondok")));
    return;
  }
  if (url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  // 잠금 화면에는 중립 문구만. 질문·기도·가족·말씀 전문은 payload 에 실리지 않는다 (REQ-PWA-010).
  const title = typeof data.title === "string" && data.title.length <= 40 ? data.title : NEUTRAL_TITLE;
  const body = typeof data.body === "string" && data.body.length <= 80 ? data.body : NEUTRAL_BODY;
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/hoondok";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/hoondok-192.png",
      badge: "/icons/hoondok-192.png",
      tag: typeof data.tag === "string" ? data.tag : "hoondok-daily",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/hoondok";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((client) => "focus" in client);
      if (open) return open.navigate(target).then((client) => client && client.focus());
      return self.clients.openWindow(target);
    }),
  );
});
