/* 은퇴한 훈독 서비스워커 (DEC-PWA-026 — 웹 루트 = 훈독). 새 SW 는 /sw.js 이고 scope 는 `/` 다.
   예전 설치본은 scope /hoondok 으로 이 URL 을 등록해 두었다. 브라우저가 업데이트 검사로 이 파일을 받으면
   (1) 대기 없이 활성화하고 (2) 예전 hoondok-* 캐시를 지운 뒤(루트 SW 의 hoondok-root-* 는 남긴다)
   (3) 열려 있던 /hoondok 창을 같은 주소로 다시 열어 서버의 308(→ 루트 주소)과 루트 SW 를 타게 한다.
   등록은 스스로 해제하지 않는다 — 해제하면 그 등록의 푸시 구독도 사라진다. 업데이트 검사는 push 처리 뒤에도 돌기 때문에
   앱을 열지 않은 구독자의 알림이 조용히 끊긴다. 그래서 push·notificationclick 은 계속 처리하고(알림 주소는 루트 경로로 연다),
   해제는 페이지 쪽(features/hoondok/notifications/legacy-push.ts)이 구독을 루트 등록으로 옮긴 뒤에 한다.
   fetch 처리기는 두지 않는다 — /hoondok/* 요청은 네트워크로 가서 308 을 탄다.
   업데이트 검사가 이 파일을 받으려면 리다이렉트 없이 200 이어야 한다 — next.config 의 /hoondok 308 규칙에서 제외한다.
   SW_VERSION 은 smoke 가 엣지 stale 을 판정하는 표지다. */
const SW_VERSION = "retired-2026-11-04.2";
const OLD_CACHE_PREFIX = "hoondok-";
const ROOT_CACHE_PREFIX = "hoondok-root-";
const LEGACY_PREFIX = /^\/hoondok(?=\/|$)/;
// 루트 SW(public/sw.js)와 같은 값이다 — 같은 태그라 새 알림이 이전 것을 덮는다.
const NOTIFICATION_TAG = "hoondok-read";
const NOTIFICATION_ICON = "/hoondok/icons/icon-192.png";
const NOTIFICATION_BADGE = "/hoondok/icons/badge-96.png";
const NOTIFICATION_FALLBACK_TITLE = "오늘의 읽을거리가 준비됐어요";

async function retire() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(OLD_CACHE_PREFIX) && !key.startsWith(ROOT_CACHE_PREFIX))
      .map((key) => caches.delete(key)),
  );
  const windows = await self.clients.matchAll({ type: "window" });
  await Promise.all(
    windows.map((client) =>
      typeof client.navigate === "function"
        ? client.navigate(client.url).catch(() => undefined) // 실패해도 다음 방문에서 308 을 탄다
        : undefined,
    ),
  );
}

/** 알림 주소 → same-origin 루트 경로. 예전 /hoondok 접두는 떼고, 외부 주소는 홈으로 바꾼다. */
function rootUrl(raw) {
  try {
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin) return new URL("/", self.location.origin).href;
    url.pathname = url.pathname.replace(LEGACY_PREFIX, "") || "/";
    return url.href;
  } catch {
    return new URL("/", self.location.origin).href;
  }
}

function notificationContent(event) {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null; // 본문이 JSON 이 아니면 중립 문구로 대신한다
  }
  const source = data && typeof data === "object" ? data : {};
  return {
    title: typeof source.title === "string" && source.title ? source.title : NOTIFICATION_FALLBACK_TITLE,
    body: typeof source.body === "string" ? source.body : "",
    url: rootUrl(typeof source.url === "string" ? source.url : "/"),
  };
}

/** 열린 같은 origin 창이 있으면 그 창을 쓰고, 없으면 새 창을 연다. */
async function openRootWindow(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows.find((client) => {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  if (!existing) return self.clients.openWindow(url);
  await existing.focus();
  if (typeof existing.navigate === "function" && existing.url !== url) {
    try {
      await existing.navigate(url);
    } catch {
      // 이 등록이 제어하지 않는 창은 navigate 가 실패한다 — focus 까지만 지킨다
    }
  }
  return existing;
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(retire());
});

self.addEventListener("push", (event) => {
  const { title, body, url } = notificationContent(event);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      tag: NOTIFICATION_TAG,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const url = rootUrl(data && typeof data.url === "string" ? data.url : "/");
  event.waitUntil(openRootWindow(url));
});
