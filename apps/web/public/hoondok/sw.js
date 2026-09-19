/* 훈독 서비스워커 (PLAN-HD-001 Phase 3 D). scope 는 /hoondok — 슬래시 없음(C-3). 스크립트가 /hoondok/ 아래 있어
   next.config headers() 의 `Service-Worker-Allowed: /hoondok` 이 있어야 이 scope 로 등록된다.
   하는 일은 셋뿐이다.
   (1) install: 오프라인 안내 페이지(/hoondok/offline) + 그 HTML 이 참조하는 /_next/static 청크 + 아이콘·manifest 를 precache.
   (2) fetch: /hoondok 아래 navigation 이 네트워크 실패하면 /hoondok/offline 로 302 리다이렉트하고, 그 URL 의 navigation 은 캐시된 안내 HTML 로
       응답한다(다른 URL 에서 안내 HTML 을 그대로 내면 usePathname 기반 앱 셸이 hydration 불일치를 낸다). precache 자산은 네트워크 실패 시 캐시.
   (3) activate: 구버전 hoondok-* 캐시 삭제 + clients.claim.
   런타임에 cache.put 을 하지 않으므로 /api/backend/* · /hoondok/onboarding · 인증 응답은 캐시에 들어갈 수 없다(ARCH-MONO-001 §7).
   sw.js 를 바꾸면 SW_VERSION 을 올린다(캐시 이름). 킬스위치: SW_KILL = true 로 배포하면 다음 방문에서 캐시 전삭제 + 등록 해제.
   rollback-web 만으로는 이미 설치된 SW 가 지워지지 않는다 — 절차는 runbook(Phase 3 G). */
const SW_VERSION = "2026-09-19.1";
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
