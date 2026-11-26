import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 알림센터 — 보낸 알림 기록·공지·행사 API 가 아직 없어 세 탭 모두 정직한 빈 상태를 보인다.
// 가짜 목록·안 읽은 수를 그리지 않는 것과, 빈 상태에서 바로 알림을 켤 수 있는 것을 지킨다.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/notifications",
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn(), deleteMe: vi.fn() },
}));
vi.mock("@/features/hoondok/notifications/api", () => ({
  notificationsAPI: { config: vi.fn(), prefs: vi.fn(), savePrefs: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

import { notificationsAPI } from "@/features/hoondok/notifications/api";
import { NotificationCenter } from "@/features/hoondok/notifications/components/notification-center";
import type { NotificationPrefs } from "@/features/hoondok/notifications/types";
import { identityAPI } from "@/features/identity/api";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const VAPID_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
let serverPrefs: NotificationPrefs;

function stubNavigator(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props))
    Object.defineProperty(navigator, key, { value, configurable: true });
  return () => {
    for (const key of Object.keys(props)) Reflect.deleteProperty(navigator, key);
  };
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let restoreNavigator = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  serverPrefs = { read_enabled: false, read_time: "06:00", subscription_count: 0 };
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
  vi.mocked(notificationsAPI.config).mockResolvedValue({ enabled: true, public_key: VAPID_KEY });
  vi.mocked(notificationsAPI.prefs).mockImplementation(async () => serverPrefs);
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: vi.fn(async () => "denied" as NotificationPermission),
  });
  restoreNavigator = stubNavigator({
    userAgent: DESKTOP_UA,
    maxTouchPoints: 0,
    serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn(async () => null) } }) },
  });
});
afterEach(() => {
  restoreNavigator();
  vi.unstubAllGlobals();
});

describe("알림센터", () => {
  it("탭 3개(알림·공지·함께해요)를 두고 화살표 키로 옮겨 다닌다 — 공지·행사는 빈 상태만", async () => {
    render(wrap(<NotificationCenter />));
    const alerts = screen.getByRole("tab", { name: "알림" });
    expect(alerts).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(alerts, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "공지" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "아직 공지가 없어요" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "함께해요" }));
    expect(screen.getByRole("heading", { name: "아직 열린 행사가 없어요" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "알림 설정" })).toHaveAttribute("href", "/settings");
  });

  it("알림을 끈 로그인 사용자: 빈 상태에서 바로 켜기 — 권한 요청은 클릭 안에서 시작한다", async () => {
    render(wrap(<NotificationCenter />));
    const enable = await screen.findByRole("button", { name: "훈독하기 알림 켜기" });
    expect(screen.getByRole("heading", { name: "받은 알림이 없어요" })).toBeInTheDocument();

    fireEvent.click(enable);
    expect(Notification.requestPermission).toHaveBeenCalledOnce();
  });

  it("알림을 켠 사용자는 다음 알림 시각을 보고, 가짜 목록·안 읽은 수는 없다", async () => {
    serverPrefs = { read_enabled: true, read_time: "06:30", subscription_count: 1 };
    render(wrap(<NotificationCenter />));
    expect(await screen.findByText(/에 훈독하기를 알려드려요/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "훈독하기 알림 켜기" })).toBeNull();
    expect(screen.getByText("지난 알림 목록은 준비 중이에요.")).toBeInTheDocument();
  });

  it("로그인 전에는 시작하기(돌아올 곳 /notifications)를 두고 알림 설정을 부르지 않는다", async () => {
    vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "로그인이 필요합니다" }));
    render(wrap(<NotificationCenter />));
    expect(await screen.findByRole("link", { name: "시작하기" })).toHaveAttribute(
      "href",
      "/onboarding?returnTo=%2Fnotifications",
    );
    await waitFor(() => expect(notificationsAPI.prefs).not.toHaveBeenCalled());
  });
});
