import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 예전 /hoondok SW 등록의 알림 구독을 루트 등록으로 옮긴 뒤에만 해제한다 (DEC-PWA-026).
vi.mock("@/features/hoondok/notifications/api", () => ({
  notificationsAPI: { config: vi.fn(), prefs: vi.fn(), savePrefs: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

import { notificationsAPI } from "@/features/hoondok/notifications/api";
import { retireLegacyRegistration } from "@/features/hoondok/notifications/legacy-push";

const VAPID_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

function fakeSubscription(endpoint: string) {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

function setup({ legacySub = true }: { legacySub?: boolean } = {}) {
  const oldSub = legacySub ? fakeSubscription("https://push.example/old") : null;
  const newSub = fakeSubscription("https://push.example/new");
  const legacy = {
    scope: `${window.location.origin}/hoondok`,
    unregister: vi.fn(async () => true),
    pushManager: { getSubscription: vi.fn(async () => oldSub) },
  };
  const root = {
    scope: `${window.location.origin}/`,
    unregister: vi.fn(async () => true),
    pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => newSub) },
  };
  const container = {
    getRegistrations: vi.fn(async () => [legacy, root]),
    ready: Promise.resolve(root),
  } as unknown as ServiceWorkerContainer;
  return { oldSub, newSub, legacy, root, container };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.mocked(notificationsAPI.config).mockResolvedValue({ enabled: true, public_key: VAPID_KEY });
  vi.mocked(notificationsAPI.subscribe).mockResolvedValue({ id: "s1", endpoint: "x", created_at: "2026-11-04" });
  vi.mocked(notificationsAPI.unsubscribe).mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("예전 /hoondok 등록 정리 (DEC-PWA-026)", () => {
  it("구독이 없으면 바로 해제한다 — 루트 등록은 건드리지 않는다", async () => {
    const { legacy, root, container } = setup({ legacySub: false });
    await retireLegacyRegistration(container);
    expect(legacy.unregister).toHaveBeenCalledOnce();
    expect(root.unregister).not.toHaveBeenCalled();
    expect(notificationsAPI.subscribe).not.toHaveBeenCalled();
  });

  it("권한이 허용된 구독은 루트 등록으로 옮기고(새 구독 등록 → 옛 구독 삭제·해지) 그 뒤에 해제한다", async () => {
    const { oldSub, legacy, root, container } = setup();
    await retireLegacyRegistration(container);
    expect(root.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(notificationsAPI.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://push.example/new", keys: { p256dh: "p", auth: "a" } }),
    );
    expect(notificationsAPI.unsubscribe).toHaveBeenCalledWith("https://push.example/old");
    expect(oldSub?.unsubscribe).toHaveBeenCalledOnce();
    expect(legacy.unregister).toHaveBeenCalledOnce();
  });

  it("서버가 새 구독을 받지 못하면(비로그인 401 등) 새 구독을 지우고 예전 등록을 남긴다", async () => {
    vi.mocked(notificationsAPI.subscribe).mockRejectedValue(new Error("401"));
    const { oldSub, newSub, legacy, container } = setup();
    await expect(retireLegacyRegistration(container)).rejects.toThrow();
    expect(newSub.unsubscribe).toHaveBeenCalledOnce();
    expect(oldSub?.unsubscribe).not.toHaveBeenCalled();
    expect(legacy.unregister).not.toHaveBeenCalled();
  });

  it("브라우저가 제스처 밖 subscribe 를 막으면(iOS) 예전 등록을 남긴다", async () => {
    const { legacy, root, container } = setup();
    root.pushManager.subscribe.mockRejectedValue(new DOMException("gesture", "NotAllowedError"));
    await expect(retireLegacyRegistration(container)).rejects.toThrow();
    expect(legacy.unregister).not.toHaveBeenCalled();
  });

  it("권한이 허용 상태가 아니거나 서버 알림이 꺼져 있으면 옮기지 않고 예전 등록을 남긴다", async () => {
    vi.stubGlobal("Notification", { permission: "default" });
    const first = setup();
    await retireLegacyRegistration(first.container);
    expect(first.legacy.unregister).not.toHaveBeenCalled();

    vi.stubGlobal("Notification", { permission: "granted" });
    vi.mocked(notificationsAPI.config).mockResolvedValue({ enabled: false, public_key: null });
    const second = setup();
    await retireLegacyRegistration(second.container);
    expect(second.root.pushManager.subscribe).not.toHaveBeenCalled();
    expect(second.legacy.unregister).not.toHaveBeenCalled();
  });
});
