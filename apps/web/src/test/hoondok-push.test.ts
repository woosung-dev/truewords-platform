import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notificationsAPI } from "@/features/hoondok/notifications/api";
import { detectPushSupport, urlBase64ToUint8Array } from "@/features/hoondok/notifications/push-support";

// PLAN-HD-006 — 알림 지원 판정(순수 함수)과 API 어댑터. React 없이 본다.
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";

function stubNavigator(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props))
    Object.defineProperty(navigator, key, { value, configurable: true });
  return () => {
    for (const key of Object.keys(props)) Reflect.deleteProperty(navigator, key);
  };
}

/** 지원되는 브라우저(Push·Notification·SW 있음, 권한 미결정, 데스크톱) 를 만든다. */
function stubSupportedBrowser(permission: NotificationPermission = "default") {
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { permission, requestPermission: vi.fn(async () => permission) });
  return stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0, serviceWorker: { ready: Promise.resolve({}) } });
}

let restoreNavigator = () => {};
beforeEach(() => {
  restoreNavigator = () => {};
});
afterEach(() => {
  restoreNavigator();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("detectPushSupport 5상태", () => {
  it("disabled: 서버 설정이 없으면 브라우저가 지원해도 켤 수 없다", () => {
    restoreNavigator = stubSupportedBrowser();
    expect(detectPushSupport(false)).toBe("disabled");
  });

  it("unsupported: PushManager·Notification·serviceWorker 중 하나라도 없으면", () => {
    restoreNavigator = stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    expect(detectPushSupport(true)).toBe("unsupported");
    vi.stubGlobal("PushManager", class {});
    expect(detectPushSupport(true)).toBe("unsupported");
    vi.stubGlobal("Notification", { permission: "default" });
    expect(detectPushSupport(true)).toBe("unsupported"); // navigator.serviceWorker 없음
  });

  it("ios-not-installed: iOS 인데 홈 화면 앱이 아니면", () => {
    restoreNavigator = stubSupportedBrowser();
    const restoreIos = stubNavigator({ userAgent: IOS_UA, maxTouchPoints: 5 });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    expect(detectPushSupport(true)).toBe("ios-not-installed");
    // 홈 화면에 추가했으면 켤 수 있다
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    expect(detectPushSupport(true)).toBe("ready");
    restoreIos();
  });

  it("denied: 이미 차단했으면 다시 물을 수 없다", () => {
    restoreNavigator = stubSupportedBrowser("denied");
    expect(detectPushSupport(true)).toBe("denied");
  });

  it("ready: 설정·브라우저·권한이 모두 통과", () => {
    restoreNavigator = stubSupportedBrowser("granted");
    expect(detectPushSupport(true)).toBe("ready");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("base64url(-,_) 과 패딩 없는 문자열을 그대로 바이트로 만든다", () => {
    const key = btoa(String.fromCharCode(251, 255, 190)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect([...urlBase64ToUint8Array(key)]).toEqual([251, 255, 190]);
  });
});

describe("notificationsAPI", () => {
  function stubFetch(status: number, body: unknown = {}) {
    const fetchMock = vi.fn(
      async () =>
        new Response(status === 204 ? null : JSON.stringify(body), {
          status,
          headers: status === 204 ? {} : { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("subscribe: POST /hoondok/me/push + 쿠키 + X-Requested-With", async () => {
    const fetchMock = stubFetch(201, { id: "s1", endpoint: "https://push.example/abc", created_at: "2026-09-22" });
    await notificationsAPI.subscribe({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
      user_agent: DESKTOP_UA,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/hoondok/me/push");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
    expect(JSON.parse(init.body as string)).toEqual({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
      user_agent: DESKTOP_UA,
    });
  });

  it("unsubscribe: endpoint 를 인코딩해 쿼리에 싣고 204 를 받는다", async () => {
    const fetchMock = stubFetch(204);
    await notificationsAPI.unsubscribe("https://push.example/a?b=1&c=2");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/hoondok/me/push?endpoint=https%3A%2F%2Fpush.example%2Fa%3Fb%3D1%26c%3D2");
    expect(init.method).toBe("DELETE");
  });

  it("savePrefs: PUT 본문은 계약 3필드뿐이다", async () => {
    const fetchMock = stubFetch(200, {
      read_enabled: true,
      read_time: "06:30",
      lock_screen_level: "faith",
      subscription_count: 1,
    });
    const prefs = await notificationsAPI.savePrefs({
      read_enabled: true,
      read_time: "06:30",
      lock_screen_level: "faith",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/hoondok/me/notifications");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      read_enabled: true,
      read_time: "06:30",
      lock_screen_level: "faith",
    });
    expect(prefs.subscription_count).toBe(1);
  });
});
