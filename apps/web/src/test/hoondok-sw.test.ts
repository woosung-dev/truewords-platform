import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// public/hoondok/sw.js 를 가짜 self·caches·fetch 로 실행해 install/activate/fetch 분기를 단언한다 (PLAN-HD-001 Phase 3 D).
// push·notificationclick 은 PLAN-HD-006 에서 같은 가짜 self 에 registration.showNotification·clients 를 더해 검증한다.
const SW_SOURCE = readFileSync(path.resolve(__dirname, "../../public/hoondok/sw.js"), "utf8");
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
      showNotification: vi.fn(async () => undefined),
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
    expect(cacheName).toMatch(/^hoondok-/);
    const keys = [...worker.store.get(cacheName)!.keys()];
    expect(keys).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/hoondok/offline`,
        `${ORIGIN}/hoondok/manifest.webmanifest`,
        `${ORIGIN}/hoondok/icons/icon-192.png`,
        `${ORIGIN}/hoondok/icons/icon-maskable-512.png`,
        `${ORIGIN}/hoondok/icons/apple-touch-icon-180.png`,
        `${ORIGIN}/_next/static/css/app.css`,
        `${ORIGIN}/_next/static/chunks/main.js?v=1`,
      ]),
    );
    expect(keys.some((k) => k.includes("/api/backend/") || k.includes("/hoondok/onboarding"))).toBe(false);
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it("fetch: /api/backend·/hoondok/onboarding·다른 origin·POST 에는 관여하지 않는다", () => {
    const worker = loadWorker();
    const untouched: FakeRequest[] = [
      { url: `${ORIGIN}/api/backend/hoondok/today`, method: "GET", mode: "cors" },
      { url: `${ORIGIN}/api/backend/hoondok/auth/me`, method: "GET", mode: "cors" },
      { url: `${ORIGIN}/hoondok/onboarding`, method: "GET", mode: "navigate" },
      { url: `${ORIGIN}/hoondok/missions/read/complete`, method: "POST", mode: "cors" },
      { url: "https://cdn.jsdelivr.net/x.css", method: "GET", mode: "no-cors" },
      { url: `${ORIGIN}/login`, method: "GET", mode: "navigate" },
    ];
    for (const request of untouched) expect(fetchEvent(worker, request), request.url).toBeUndefined();
  });

  it("fetch: /hoondok 아래 navigation 이 실패하면 /hoondok/offline 로 302, 그 URL 은 precache 된 안내 HTML", async () => {
    const online = loadWorker();
    await online.dispatch("install", {});
    const offlineWorker = loadWorker(SW_SOURCE, { fetchFails: true });
    // install 은 온라인 워커로, fetch 는 오프라인 워커로 — 캐시를 옮겨 붙인다
    for (const [name, bucket] of online.store) offlineWorker.store.set(name, bucket);
    const redirected = await fetchEvent(offlineWorker, {
      url: `${ORIGIN}/hoondok/read`,
      method: "GET",
      mode: "navigate",
    });
    expect(redirected).toBeInstanceOf(Response);
    expect((redirected as Response).status).toBe(302);
    expect((redirected as Response).headers.get("location")).toBe(`${ORIGIN}/hoondok/offline`);
    const response = await fetchEvent(offlineWorker, {
      url: `${ORIGIN}/hoondok/offline`,
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
    worker.store.set("other-app", new Map());
    await worker.dispatch("install", {});
    await worker.dispatch("activate", {});
    const names = [...worker.store.keys()];
    expect(names).not.toContain("hoondok-old");
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
    expect(fetchEvent(worker, { url: `${ORIGIN}/hoondok/read`, method: "GET", mode: "navigate" })).toBeUndefined();
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
    await worker.dispatch(
      "push",
      pushEvent({ title: "오늘의 말씀이 준비됐어요", body: "참부모경 1편", url: "/hoondok/read" }),
    );
    expect(worker.self.registration.showNotification).toHaveBeenCalledWith("오늘의 말씀이 준비됐어요", {
      body: "참부모경 1편",
      icon: "/hoondok/icons/icon-192.png",
      badge: "/hoondok/icons/icon-192.png",
      tag: "hoondok-read",
      data: { url: `${ORIGIN}/hoondok/read` },
    });
  });

  it("push: 데이터가 없거나 깨졌으면 중립 문구 + /hoondok, 외부 url 도 /hoondok 으로 되돌린다", async () => {
    const broken = loadWorker();
    await broken.dispatch("push", pushEvent(null, { broken: true }));
    await broken.dispatch("push", {});
    await broken.dispatch("push", pushEvent({ title: "", url: "https://evil.example/hoondok" }));
    for (const call of vi.mocked(broken.self.registration.showNotification).mock.calls) {
      expect(call[0]).toBe("오늘의 읽을거리가 준비됐어요");
      expect((call[1] as { data: { url: string } }).data.url).toBe(`${ORIGIN}/hoondok`);
    }
    expect(broken.self.registration.showNotification).toHaveBeenCalledTimes(3);
  });

  it("notificationclick: 열린 훈독 창이 있으면 focus + navigate, 없으면 새 창", async () => {
    const hoondokWindow: FakeWindow = {
      url: `${ORIGIN}/hoondok/garden`,
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    const close = vi.fn();
    const withWindow = loadWorker(SW_SOURCE, { windows: [hoondokWindow] });
    await withWindow.dispatch("notificationclick", {
      notification: { close, data: { url: `${ORIGIN}/hoondok/read` } },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(hoondokWindow.focus).toHaveBeenCalledOnce();
    expect(hoondokWindow.navigate).toHaveBeenCalledWith(`${ORIGIN}/hoondok/read`);
    expect(withWindow.self.clients.openWindow).not.toHaveBeenCalled();

    // 훈독 밖 창(시연 챗)만 열려 있으면 재사용하지 않는다
    const otherWindow: FakeWindow = { url: `${ORIGIN}/history`, focus: vi.fn(async () => undefined) };
    const withoutWindow = loadWorker(SW_SOURCE, { windows: [otherWindow] });
    await withoutWindow.dispatch("notificationclick", {
      notification: { close: vi.fn(), data: { url: `${ORIGIN}/hoondok/read` } },
    });
    expect(otherWindow.focus).not.toHaveBeenCalled();
    expect(withoutWindow.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/hoondok/read`);
  });

  it("킬스위치: SW_KILL=true 면 push·notificationclick 도 아무것도 하지 않는다", async () => {
    const worker = loadWorker(SW_SOURCE.replace("const SW_KILL = false;", "const SW_KILL = true;"));
    await worker.dispatch("push", pushEvent({ title: "x" }));
    const close = vi.fn();
    await worker.dispatch("notificationclick", { notification: { close, data: { url: `${ORIGIN}/hoondok` } } });
    expect(worker.self.registration.showNotification).not.toHaveBeenCalled();
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
