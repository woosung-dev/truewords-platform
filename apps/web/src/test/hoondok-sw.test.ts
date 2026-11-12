import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// public/sw.js(루트 scope, DEC-PWA-026)를 가짜 self·caches·fetch 로 실행해 install/activate/fetch 분기를 단언한다 (PLAN-HD-001 Phase 3 D).
// push·notificationclick 은 PLAN-HD-006 에서 같은 가짜 self 에 registration.showNotification·clients 를 더해 검증한다.
const SW_SOURCE = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
const RETIRED_SW_SOURCE = readFileSync(path.resolve(__dirname, "../../public/hoondok/sw.js"), "utf8");
const ORIGIN = "https://truewords.example";
const OFFLINE_HTML =
  '<html><head><link rel="stylesheet" href="/_next/static/css/app.css"/></head>' +
  '<body><script src="/_next/static/chunks/main.js?v=1"></script></body></html>';

type Listener = (event: Record<string, unknown>) => void;
type FakeWindow = { url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> };
type FakeRequest = { url: string; method: string; mode: string };

function keyOf(input: string | FakeRequest) {
  const raw = typeof input === "string" ? input : input.url;
  return new URL(raw, ORIGIN).href;
}

function loadWorker(source = SW_SOURCE, { fetchFails = false, windows = [] as FakeWindow[] } = {}) {
  const listeners = new Map<string, Listener>();
  const store = new Map<string, Map<string, unknown>>();
  const openCache = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const bucket = store.get(name)!;
    return {
      put: async (key: string, value: unknown) => void bucket.set(keyOf(key), value),
      add: async (key: string) => void bucket.set(keyOf(key), "precached"),
      match: async (key: string | FakeRequest) => bucket.get(keyOf(key)),
    };
  };
  const caches = {
    keys: async () => [...store.keys()],
    open: openCache,
    delete: async (name: string) => store.delete(name),
    match: async (key: string | FakeRequest) => {
      for (const bucket of store.values()) if (bucket.has(keyOf(key))) return bucket.get(keyOf(key));
      return undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => void listeners.set(type, fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async (url: string) => ({ url })),
    },
    registration: {
      unregister: vi.fn(async () => true),
      showNotification: vi.fn<(title: string, options: Record<string, unknown>) => Promise<void>>(
        async () => undefined,
      ),
    },
  };
  const fetchMock = vi.fn(async () => {
    if (fetchFails) throw new TypeError("Failed to fetch");
    return new Response(OFFLINE_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
  });
  vm.runInNewContext(source, { self, caches, fetch: fetchMock, Response, URL, console });
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> | undefined;
    listeners.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => void (pending = p) });
    await pending;
  };
  return { store, self, fetchMock, dispatch, listeners };
}

function fetchEvent(worker: ReturnType<typeof loadWorker>, request: FakeRequest) {
  let responded: Promise<Response> | undefined;
  worker.listeners.get("fetch")?.({ request, respondWith: (p: Promise<Response>) => void (responded = p) });
  return responded;
}

describe("훈독 서비스워커", () => {
  it("install: 오프라인 안내 + 참조 청크 + 아이콘·manifest 를 precache 하고 API·온보딩은 없다", async () => {
    const worker = await (async () => {
      const w = loadWorker();
      await w.dispatch("install", {});
      return w;
    })();
    const [cacheName] = [...worker.store.keys()];
    expect(cacheName).toMatch(/^hoondok-root-/);
    const keys = [...worker.store.get(cacheName)!.keys()];
    expect(keys).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/offline`,
        `${ORIGIN}/hoondok/manifest.webmanifest`,
        `${ORIGIN}/hoondok/icons/icon-192.png`,
        `${ORIGIN}/hoondok/icons/icon-maskable-512.png`,
        `${ORIGIN}/hoondok/icons/apple-touch-icon-180.png`,
        `${ORIGIN}/hoondok/icons/badge-96.png`,
        `${ORIGIN}/_next/static/css/app.css`,
        `${ORIGIN}/_next/static/chunks/main.js?v=1`,
      ]),
    );
    expect(keys.some((k) => k.includes("/api/backend/") || k.includes("/onboarding"))).toBe(false);
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it("fetch: /api/*·/admin/*·/onboarding·다른 origin·POST 에는 관여하지 않는다", () => {
    const worker = loadWorker();
    const untouched: FakeRequest[] = [
      { url: `${ORIGIN}/api/backend/hoondok/today`, method: "GET", mode: "cors" },
      { url: `${ORIGIN}/api/backend/hoondok/auth/me`, method: "GET", mode: "cors" },
      { url: `${ORIGIN}/onboarding`, method: "GET", mode: "navigate" },
      // 구글 로그인 도착 페이지와 서버 콜백(code·state 가 붙는다)도 캐시하지 않는다
      { url: `${ORIGIN}/onboarding/done?status=signed_in&returnTo=%2Fread`, method: "GET", mode: "navigate" },
      { url: `${ORIGIN}/api/backend/hoondok/auth/oauth/google/callback?code=c&state=s`, method: "GET", mode: "navigate" },
      { url: `${ORIGIN}/hoondok/missions/read/complete`, method: "POST", mode: "cors" },
      { url: "https://cdn.jsdelivr.net/x.css", method: "GET", mode: "no-cors" },
      { url: `${ORIGIN}/api/chat/stream`, method: "GET", mode: "cors" },
      { url: `${ORIGIN}/admin/auth/me`, method: "GET", mode: "navigate" },
      // 카드 공유 이미지(라우트 핸들러)는 precache 자산이 아니다
      { url: `${ORIGIN}/c/abc/image?f=link`, method: "GET", mode: "no-cors" },
    ];
    for (const request of untouched) expect(fetchEvent(worker, request), request.url).toBeUndefined();
  });

  it("fetch: / 아래 navigation 이 실패하면 /offline 로 302, 그 URL 은 precache 된 안내 HTML", async () => {
    const online = loadWorker();
    await online.dispatch("install", {});
    const offlineWorker = loadWorker(SW_SOURCE, { fetchFails: true });
    // install 은 온라인 워커로, fetch 는 오프라인 워커로 — 캐시를 옮겨 붙인다
    for (const [name, bucket] of online.store) offlineWorker.store.set(name, bucket);
    const redirected = await fetchEvent(offlineWorker, {
      url: `${ORIGIN}/read`,
      method: "GET",
      mode: "navigate",
    });
    expect(redirected).toBeInstanceOf(Response);
    expect((redirected as Response).status).toBe(302);
    expect((redirected as Response).headers.get("location")).toBe(`${ORIGIN}/offline`);
    const response = await fetchEvent(offlineWorker, {
      url: `${ORIGIN}/offline`,
      method: "GET",
      mode: "navigate",
    });
    expect(await (response as Response).text()).toContain("_next/static");
    // precache 된 청크도 네트워크 실패 시 캐시로 대신한다
    const asset = await fetchEvent(offlineWorker, {
      url: `${ORIGIN}/_next/static/css/app.css`,
      method: "GET",
      mode: "no-cors",
    });
    expect(asset).toBe("precached");
  });

  it("activate: 구버전 hoondok-* 캐시만 지우고 clients.claim 한다", async () => {
    const worker = loadWorker();
    worker.store.set("hoondok-old", new Map());
    // 예전 /hoondok scope SW 의 캐시 이름 형식
    worker.store.set("hoondok-2026-11-03.2", new Map());
    worker.store.set("other-app", new Map());
    await worker.dispatch("install", {});
    await worker.dispatch("activate", {});
    const names = [...worker.store.keys()];
    expect(names).not.toContain("hoondok-old");
    expect(names).not.toContain("hoondok-2026-11-03.2");
    expect(names).toContain("other-app");
    expect(names.filter((n) => n.startsWith("hoondok-"))).toHaveLength(1);
    expect(worker.self.clients.claim).toHaveBeenCalledOnce();
    expect(worker.self.registration.unregister).not.toHaveBeenCalled();
  });

  it("킬스위치: SW_KILL=true 면 precache 없이 skipWaiting, 캐시 전삭제 + unregister, fetch 미관여", async () => {
    expect(SW_SOURCE).toContain("const SW_KILL = false;");
    const worker = loadWorker(SW_SOURCE.replace("const SW_KILL = false;", "const SW_KILL = true;"));
    worker.store.set("hoondok-2026-09-19.1", new Map([["x", 1]]));
    worker.store.set("other-app", new Map());
    await worker.dispatch("install", {});
    expect(worker.fetchMock).not.toHaveBeenCalled();
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    await worker.dispatch("activate", {});
    expect([...worker.store.keys()]).toEqual([]);
    expect(worker.self.registration.unregister).toHaveBeenCalledOnce();
    expect(fetchEvent(worker, { url: `${ORIGIN}/read`, method: "GET", mode: "navigate" })).toBeUndefined();
  });
});

describe("훈독 서비스워커 알림 (PLAN-HD-006)", () => {
  function pushEvent(payload: unknown, { broken = false } = {}) {
    return {
      data: broken
        ? {
            json: () => {
              throw new SyntaxError("not json");
            },
          }
        : { json: () => payload },
    };
  }

  it("push: 서버 페이로드로 알림 하나 — 태그·아이콘·data.url 고정", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", pushEvent({ title: "오늘의 말씀이 준비됐어요", body: "참부모경 1편", url: "/read" }));
    expect(worker.self.registration.showNotification).toHaveBeenCalledWith("오늘의 말씀이 준비됐어요", {
      body: "참부모경 1편",
      icon: "/hoondok/icons/icon-192.png",
      badge: "/hoondok/icons/badge-96.png",
      tag: "hoondok-read",
      data: { url: `${ORIGIN}/read` },
    });
  });

  it("push: 데이터가 없거나 깨졌으면 중립 문구 + /, 외부 url 도 / 으로 되돌린다", async () => {
    const broken = loadWorker();
    await broken.dispatch("push", pushEvent(null, { broken: true }));
    await broken.dispatch("push", {});
    await broken.dispatch("push", pushEvent({ title: "", url: "https://evil.example/hoondok" }));
    for (const [title, options] of broken.self.registration.showNotification.mock.calls) {
      expect(title).toBe("오늘의 읽을거리가 준비됐어요");
      expect((options as { data: { url: string } }).data.url).toBe(`${ORIGIN}/`);
    }
    expect(broken.self.registration.showNotification).toHaveBeenCalledTimes(3);
  });

  it("notificationclick: 열린 훈독 창이 있으면 focus + navigate, 없으면 새 창", async () => {
    const hoondokWindow: FakeWindow = {
      url: `${ORIGIN}/garden`,
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    const close = vi.fn();
    const withWindow = loadWorker(SW_SOURCE, { windows: [hoondokWindow] });
    await withWindow.dispatch("notificationclick", {
      notification: { close, data: { url: `${ORIGIN}/read` } },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(hoondokWindow.focus).toHaveBeenCalledOnce();
    expect(hoondokWindow.navigate).toHaveBeenCalledWith(`${ORIGIN}/read`);
    expect(withWindow.self.clients.openWindow).not.toHaveBeenCalled();

    // 다른 origin 창(관리자 앱 등)은 재사용하지 않는다
    const otherWindow: FakeWindow = { url: "https://admin.truewords.example/", focus: vi.fn(async () => undefined) };
    const withoutWindow = loadWorker(SW_SOURCE, { windows: [otherWindow] });
    await withoutWindow.dispatch("notificationclick", {
      notification: { close: vi.fn(), data: { url: `${ORIGIN}/read` } },
    });
    expect(otherWindow.focus).not.toHaveBeenCalled();
    expect(withoutWindow.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/read`);
  });

  it("킬스위치: SW_KILL=true 면 push·notificationclick 도 아무것도 하지 않는다", async () => {
    const worker = loadWorker(SW_SOURCE.replace("const SW_KILL = false;", "const SW_KILL = true;"));
    await worker.dispatch("push", pushEvent({ title: "x" }));
    const close = vi.fn();
    await worker.dispatch("notificationclick", { notification: { close, data: { url: `${ORIGIN}/` } } });
    expect(worker.self.registration.showNotification).not.toHaveBeenCalled();
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("은퇴한 /hoondok 서비스워커 (DEC-PWA-026)", () => {
  it("바로 활성화해 예전 캐시만 지우고 열린 창을 다시 연다 — 등록은 해제하지 않는다(푸시 구독 보존), fetch 처리기는 없다", async () => {
    const legacyWindow: FakeWindow = {
      url: `${ORIGIN}/hoondok/read`,
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    const worker = loadWorker(RETIRED_SW_SOURCE, { windows: [legacyWindow] });
    worker.store.set("hoondok-2026-11-03.2", new Map());
    worker.store.set("hoondok-root-2026-11-04.2", new Map());
    worker.store.set("other-app", new Map());
    await worker.dispatch("install", {});
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    await worker.dispatch("activate", {});
    expect([...worker.store.keys()].sort()).toEqual(["hoondok-root-2026-11-04.2", "other-app"]);
    expect(worker.self.registration.unregister).not.toHaveBeenCalled();
    expect(legacyWindow.navigate).toHaveBeenCalledWith(`${ORIGIN}/hoondok/read`);
    expect(worker.listeners.has("fetch")).toBe(false);
    expect(RETIRED_SW_SOURCE).toMatch(/SW_VERSION = "[^"]+"/);
  });

  it("앱을 열지 않은 예전 구독자에게도 알림을 띄우고, 주소는 /hoondok 접두를 뗀 루트 경로로 연다", async () => {
    const worker = loadWorker(RETIRED_SW_SOURCE);
    await worker.dispatch("push", {
      data: { json: () => ({ title: "오늘의 책갈피가 꽂혀 있어요", body: "본문", url: "/hoondok/bookmark" }) },
    });
    const [title, options] = worker.self.registration.showNotification.mock.calls[0];
    expect(title).toBe("오늘의 책갈피가 꽂혀 있어요");
    expect(options).toMatchObject({ tag: "hoondok-read", data: { url: `${ORIGIN}/bookmark` } });

    // 외부 주소는 열지 않는다
    await worker.dispatch("push", { data: { json: () => ({ title: "t", url: "https://evil.example/x" }) } });
    expect(worker.self.registration.showNotification.mock.calls[1][1]).toMatchObject({ data: { url: `${ORIGIN}/` } });
  });

  it("예전 SW 가 띄운 마지막 알림을 눌러도 루트 주소로 창을 연다", async () => {
    const worker = loadWorker(RETIRED_SW_SOURCE);
    const close = vi.fn();
    await worker.dispatch("notificationclick", {
      notification: { close, data: { url: `${ORIGIN}/hoondok` } },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
