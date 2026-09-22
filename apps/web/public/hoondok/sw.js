/* 훈독 서비스워커 (PLAN-HD-001 Phase 3 D). scope 는 /hoondok — 슬래시 없음(C-3). 스크립트가 /hoondok/ 아래 있어
   next.config headers() 의 `Service-Worker-Allowed: /hoondok` 이 있어야 이 scope 로 등록된다.
   하는 일은 다섯이다.
   (1) install: 오프라인 안내 페이지(/hoondok/offline) + 그 HTML 이 참조하는 /_next/static 청크 + 아이콘·manifest 를 precache.
   (2) fetch: /hoondok 아래 navigation 이 네트워크 실패하면 /hoondok/offline 로 302 리다이렉트하고, 그 URL 의 navigation 은 캐시된 안내 HTML 로
       응답한다(다른 URL 에서 안내 HTML 을 그대로 내면 usePathname 기반 앱 셸이 hydration 불일치를 낸다). precache 자산은 네트워크 실패 시 캐시.
   (3) activate: 구버전 hoondok-* 캐시 삭제 + clients.claim.
   (4) push: 서버가 보낸 {title, body, url} 로 알림 하나를 띄운다(태그 hoondok-read — 같은 태그는 덮어쓰므로 쌓이지 않는다).
       데이터가 없거나 깨졌으면 신앙 맥락이 드러나지 않는 중립 문구로 대신한다(DES-PWA-003 잠금 화면 문구 기본값).
   (5) notificationclick: 열려 있는 /hoondok 창이 있으면 그 창을 focus 후 해당 URL 로 보내고, 없으면 새 창을 연다.
   런타임에 cache.put 을 하지 않으므로 /api/backend/* · /hoondok/onboarding · 인증 응답은 캐시에 들어갈 수 없다(ARCH-MONO-001 §7).
   sw.js 를 바꾸면 SW_VERSION 을 올린다(캐시 이름). 킬스위치: SW_KILL = true 로 배포하면 다음 방문에서 캐시 전삭제 + 등록 해제.
   rollback-web 만으로는 이미 설치된 SW 가 지워지지 않는다 — 절차는 runbook(Phase 3 G). */
const SW_VERSION = "2026-09-22.1";
const SW_KILL = false;
const CACHE_PREFIX = "hoondok-";
const CACHE_NAME = `${CACHE_PREFIX}${SW_VERSION}`;
const SCOPE_PATH = "/hoondok";
const OFFLINE_URL = "/hoondok/offline";
const PRECACHE_URLS = [
  "/hoondok/manifest.webmanifest",
  "/hoondok/icons/icon-192.png",
  "/hoondok/icons/icon-512.png",
  "/hoondok/icons/icon-maskable-512.png",
  "/hoondok/icons/apple-touch-icon-180.png",
];
// 이 접두의 요청에는 관여하지 않는다(respondWith 없음) — 네트워크 그대로, 캐시 금지.
const NEVER_TOUCH = ["/api/backend/", "/hoondok/onboarding", "/hoondok/auth"];
// 알림 (PLAN-HD-006). 한 종류뿐이라 태그도 하나다 — 새 알림이 이전 것을 덮는다.
const NOTIFICATION_TAG = "hoondok-read";
const NOTIFICATION_ICON = "/hoondok/icons/icon-192.png";
const NOTIFICATION_FALLBACK_TITLE = "오늘의 읽을거리가 준비됐어요";

/** 오프라인 안내 HTML 이 참조하는 same-origin /_next/static 자산(CSS·JS 청크) URL 을 모은다. */
function collectNextAssets(html) {
  const urls = new Set();
  const attr = /(?:href|src)=["']([^"']*\/_next\/static\/[^"']+)["']/g;
  let match = attr.exec(html);
  while (match) {
    urls.add(new URL(match[1].replace(/&amp;/g, "&"), self.location.origin).href);
    match = attr.exec(html);
  }
  return [...urls];
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const offline = await fetch(OFFLINE_URL, { cache: "no-store", credentials: "omit" });
  if (!offline.ok) throw new Error(`offline page ${offline.status}`);
  const html = await offline.clone().text();
  await cache.put(OFFLINE_URL, offline);
  // 청크 하나가 실패해도 설치는 계속한다 — 필수는 오프라인 안내 HTML 하나다.
  const assets = [...PRECACHE_URLS, ...collectNextAssets(html)];
  await Promise.allSettled(assets.map((url) => cache.add(url)));
}

async function cleanupOldCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
  );
}

async function killSwitch() {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  await self.registration.unregister();
}

async function offlineFallback(url) {
  // 안내 HTML 은 자기 URL(/hoondok/offline) 에서만 낸다 — 다른 경로는 그쪽으로 보내 hydration 이 경로와 맞게 한다.
  if (url.pathname !== OFFLINE_URL) return Response.redirect(new URL(OFFLINE_URL, self.location.origin).href, 302);
  const cached = await caches.match(OFFLINE_URL);
  return (
    cached ??
    new Response("오프라인입니다. 연결 후 다시 시도해 주세요.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(SW_KILL ? self.skipWaiting() : precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(SW_KILL ? killSwitch() : cleanupOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (SW_KILL) return;
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_TOUCH.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    if (!url.pathname.startsWith(SCOPE_PATH)) return;
    event.respondWith(fetch(request).catch(() => offlineFallback(url)));
    return;
  }
  // precache 된 자산(오프라인 안내의 청크·아이콘·manifest)만 네트워크 실패 시 캐시로 대신한다. 런타임 저장은 없다.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith(`${SCOPE_PATH}/`)) {
    event.respondWith(fetch(request).catch(() => caches.match(request).then((hit) => hit ?? Response.error())));
  }
});

/** push 페이로드 → 알림 재료. 서버가 준 url 도 same-origin /hoondok 아래만 받는다(외부로 열지 않는다). */
function notificationContent(event) {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null; // 본문이 JSON 이 아니면 중립 문구로 대신한다
  }
  const source = data && typeof data === "object" ? data : {};
  const url = typeof source.url === "string" ? new URL(source.url, self.location.origin) : null;
  const isSafe = url && url.origin === self.location.origin && url.pathname.startsWith(SCOPE_PATH);
  return {
    title: typeof source.title === "string" && source.title ? source.title : NOTIFICATION_FALLBACK_TITLE,
    body: typeof source.body === "string" ? source.body : "",
    url: isSafe ? url.href : new URL(SCOPE_PATH, self.location.origin).href,
  };
}

/** 이미 열린 훈독 창을 재사용한다 — 탭이 늘어나면 사용자는 어느 쪽이 최신인지 알 수 없다. */
async function openHoondokWindow(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows.find((client) => {
    try {
      const current = new URL(client.url);
      return current.origin === self.location.origin && current.pathname.startsWith(SCOPE_PATH);
    } catch {
      return false;
    }
  });
  if (!existing) return self.clients.openWindow(url);
  await existing.focus();
  // navigate 는 SW 가 제어하는 창에서만 되고 브라우저에 따라 없다 — 실패해도 focus 까지는 지킨다.
  if (typeof existing.navigate === "function" && existing.url !== url) {
    try {
      await existing.navigate(url);
    } catch {
      // 이동 실패: 사용자가 이미 훈독 창을 보고 있으므로 그대로 둔다
    }
  }
  return existing;
}

self.addEventListener("push", (event) => {
  if (SW_KILL) return;
  const { title, body, url } = notificationContent(event);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      tag: NOTIFICATION_TAG,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  if (SW_KILL) return;
  event.notification.close();
  const data = event.notification.data;
  const url = data && typeof data.url === "string" ? data.url : new URL(SCOPE_PATH, self.location.origin).href;
  event.waitUntil(openHoondokWindow(url));
});
