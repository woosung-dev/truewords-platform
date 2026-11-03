/* 은퇴한 훈독 서비스워커 (DEC-PWA-026 — 웹 루트 = 훈독). 새 SW 는 /sw.js 이고 scope 는 `/` 다.
   예전 설치본은 scope /hoondok 으로 이 URL 을 등록해 두었다. 브라우저가 업데이트 검사로 이 파일을 받으면
   (1) 대기 없이 활성화하고 (2) 예전 hoondok-* 캐시를 지운 뒤(루트 SW 의 hoondok-root-* 는 남긴다) (3) 등록을 스스로 해제하고
   (4) 열려 있던 /hoondok 창을 같은 주소로 다시 열어 서버의 308(→ 루트 주소)과 루트 SW 를 타게 한다.
   fetch·push 처리기는 두지 않는다 — 요청은 네트워크로 그대로 간다. 이 등록의 푸시 구독은 해제와 함께 사라지므로
   예전 구독자는 설정 화면에서 알림을 다시 켜야 한다(서버는 404·410 응답으로 옛 구독을 지운다).
   업데이트 검사가 이 파일을 받으려면 리다이렉트 없이 200 이어야 한다 — next.config 의 /hoondok 308 규칙에서 제외한다.
   SW_VERSION 은 smoke 가 엣지 stale 을 판정하는 표지다. */
const SW_VERSION = "retired-2026-11-04.1";
const OLD_CACHE_PREFIX = "hoondok-";
const ROOT_CACHE_PREFIX = "hoondok-root-";

async function retire() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(OLD_CACHE_PREFIX) && !key.startsWith(ROOT_CACHE_PREFIX))
      .map((key) => caches.delete(key)),
  );
  await self.registration.unregister();
  const windows = await self.clients.matchAll({ type: "window" });
  await Promise.all(
    windows.map((client) =>
      typeof client.navigate === "function"
        ? client.navigate(client.url).catch(() => undefined) // 실패해도 다음 방문에서 308 을 탄다
        : undefined,
    ),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(retire());
});
