import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SCR-PWA-015 훈독하기 알림 (PLAN-HD-006 C). 설정 화면 + usePushNotifications 를 함께 본다 —
// 토글 한 번이 권한·구독·서버 설정 세 단계를 거치므로 단계별로 쪼개면 계약이 드러나지 않는다.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/hoondok/settings",
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn(), deleteMe: vi.fn() },
}));
vi.mock("@/features/hoondok/notifications/api", () => ({
  notificationsAPI: { config: vi.fn(), prefs: vi.fn(), savePrefs: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() },
}));
vi.mock("@/features/hoondok/observability/report", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportClientError: vi.fn(),
}));

import { notificationsAPI } from "@/features/hoondok/notifications/api";
import type { NotificationPrefs } from "@/features/hoondok/notifications/types";
import { PUSH_MESSAGES } from "@/features/hoondok/notifications/use-push-notifications";
import { reportClientError } from "@/features/hoondok/observability/report";
import { SettingsScreen } from "@/features/hoondok/settings/components/settings-screen";
import { identityAPI } from "@/features/identity/api";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
const VAPID_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const ENDPOINT = "https://push.example/abc?token=1";
const READ_TOGGLE = "훈독하기 알림";
const SOON_TOGGLES = ["기도하기 알림", "가정예배 알림", "공지 알림"];

const subscription = {
  endpoint: ENDPOINT,
  unsubscribe: vi.fn(async () => true),
  toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p256", auth: "auth" } }),
};
const pushManager = {
  subscribe: vi.fn(async () => subscription),
  getSubscription: vi.fn(async (): Promise<typeof subscription | null> => null),
};
let serverPrefs: NotificationPrefs;

function stubNavigator(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props))
    Object.defineProperty(navigator, key, { value, configurable: true });
  return () => {
    for (const key of Object.keys(props)) Reflect.deleteProperty(navigator, key);
  };
}

/** 켤 수 있는 브라우저 + VAPID 가 있는 서버. 개별 테스트가 필요한 조각만 다시 덮는다. */
function stubReadyBrowser(permission: NotificationPermission = "default") {
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: vi.fn(async () => "granted" as NotificationPermission),
  });
  return stubNavigator({
    userAgent: DESKTOP_UA,
    maxTouchPoints: 0,
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let restoreNavigator = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  serverPrefs = { read_enabled: false, read_time: "06:00", lock_screen_level: "neutral", subscription_count: 0 };
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
  vi.mocked(notificationsAPI.config).mockResolvedValue({ enabled: true, public_key: VAPID_KEY });
  vi.mocked(notificationsAPI.prefs).mockImplementation(async () => serverPrefs);
  vi.mocked(notificationsAPI.savePrefs).mockImplementation(async (body) => {
    serverPrefs = { ...serverPrefs, ...body };
    return serverPrefs;
  });
  vi.mocked(notificationsAPI.subscribe).mockResolvedValue({
    id: "s1",
    endpoint: ENDPOINT,
    created_at: "2026-09-22T00:00:00Z",
  });
  vi.mocked(notificationsAPI.unsubscribe).mockResolvedValue({});
  pushManager.getSubscription.mockResolvedValue(null);
  restoreNavigator = stubReadyBrowser();
});
afterEach(() => {
  restoreNavigator();
  vi.unstubAllGlobals();
});

function readToggle() {
  return screen.getByRole("button", { name: READ_TOGGLE });
}

describe("훈독하기 알림 켜기", () => {
  it("권한 요청 → 구독 → POST /hoondok/me/push → PUT read_enabled=true", async () => {
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(readToggle()).toBeEnabled());

    fireEvent.click(readToggle());

    await waitFor(() => expect(notificationsAPI.savePrefs).toHaveBeenCalled());
    expect(Notification.requestPermission).toHaveBeenCalledOnce();
    const [options] = pushManager.subscribe.mock.calls[0] as unknown as [PushSubscriptionOptionsInit];
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect((options.applicationServerKey as Uint8Array).length).toBe(65);
    expect(notificationsAPI.subscribe).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      keys: { p256dh: "p256", auth: "auth" },
      user_agent: DESKTOP_UA,
    });
    expect(notificationsAPI.savePrefs).toHaveBeenCalledWith({
      read_enabled: true,
      read_time: "06:00",
      lock_screen_level: "neutral",
    });
    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "true"));
    // 켜진 뒤에만 시간을 고를 수 있다
    expect(screen.getByLabelText("훈독하기 알림 시간")).toHaveValue("06:00");
  });

  it("권한을 거절하면 구독도 서버 저장도 없고 안내만 바뀐다", async () => {
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: vi.fn(async () => "denied" as NotificationPermission),
    });
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(readToggle()).toBeEnabled());

    fireEvent.click(readToggle());

    expect(await screen.findByRole("alert")).toHaveTextContent(PUSH_MESSAGES.permission);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(notificationsAPI.savePrefs).not.toHaveBeenCalled();
    // 거절은 오류가 아니다 — 보고하지 않는다
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it("409 PUSH_DISABLED 는 서버가 아직 보낼 수 없다는 뜻이다", async () => {
    vi.mocked(notificationsAPI.subscribe).mockRejectedValue(
      new ApiError(409, { error_code: "PUSH_DISABLED", message: "push disabled" }),
    );
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(readToggle()).toBeEnabled());

    fireEvent.click(readToggle());

    expect(await screen.findByRole("alert")).toHaveTextContent(PUSH_MESSAGES.pushDisabled);
    expect(notificationsAPI.savePrefs).not.toHaveBeenCalled();
    expect(reportClientError).toHaveBeenCalledWith("push_subscribe");
    // 서버가 받지 못한 구독은 브라우저에도 남기지 않는다.
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("그 밖의 실패는 push_subscribe 로 보고하고 사용자에게는 한 줄만 보인다", async () => {
    vi.mocked(notificationsAPI.subscribe).mockRejectedValue(new ApiError(503, { message: "down" }));
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(readToggle()).toBeEnabled());

    fireEvent.click(readToggle());

    expect(await screen.findByRole("alert")).toHaveTextContent(PUSH_MESSAGES.failed);
    expect(reportClientError).toHaveBeenCalledWith("push_subscribe");
  });
});

describe("훈독하기 알림 끄기·바꾸기", () => {
  beforeEach(() => {
    serverPrefs = { read_enabled: true, read_time: "06:00", lock_screen_level: "neutral", subscription_count: 1 };
    pushManager.getSubscription.mockResolvedValue(subscription);
  });

  it("이 기기 구독을 해제하고 DELETE 한 뒤 read_enabled=false 로 저장한다", async () => {
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(readToggle());

    await waitFor(() => expect(notificationsAPI.unsubscribe).toHaveBeenCalledWith(ENDPOINT));
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(notificationsAPI.savePrefs).toHaveBeenCalledWith({
      read_enabled: false,
      read_time: "06:00",
      lock_screen_level: "neutral",
    });
    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "false"));
  });

  it("시간·잠금 화면 문구는 구독을 건드리지 않고 PUT 만 한다", async () => {
    render(wrap(<SettingsScreen />));
    const time = await screen.findByLabelText("훈독하기 알림 시간");

    fireEvent.change(time, { target: { value: "05:30" } });
    await waitFor(() =>
      expect(notificationsAPI.savePrefs).toHaveBeenCalledWith({
        read_enabled: true,
        read_time: "05:30",
        lock_screen_level: "neutral",
      }),
    );

    fireEvent.click(screen.getAllByRole("radio")[1]);
    await waitFor(() =>
      expect(notificationsAPI.savePrefs).toHaveBeenCalledWith({
        read_enabled: true,
        read_time: "05:30",
        lock_screen_level: "faith",
      }),
    );
    expect(notificationsAPI.subscribe).not.toHaveBeenCalled();
    expect(notificationsAPI.unsubscribe).not.toHaveBeenCalled();
  });

  it("서버는 켜졌는데 이 기기 구독이 없으면 다시 켜라고 알린다", async () => {
    pushManager.getSubscription.mockResolvedValue(null);
    render(wrap(<SettingsScreen />));

    expect(await screen.findByText(PUSH_MESSAGES.otherDevice)).toBeInTheDocument();
  });
});

describe("켤 수 없는 상태", () => {
  it("서버 설정이 없으면 지금까지처럼 4종 모두 '준비 중' 이다", async () => {
    vi.mocked(notificationsAPI.config).mockResolvedValue({ enabled: false, public_key: null });
    render(wrap(<SettingsScreen />));

    await waitFor(() => expect(screen.getAllByText("준비 중")).toHaveLength(6));
    for (const label of [READ_TOGGLE, ...SOON_TOGGLES]) {
      const toggle = screen.getByRole("button", { name: label });
      expect(toggle).toBeDisabled();
      expect(toggle).toHaveAttribute("aria-pressed", "false");
    }
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(notificationsAPI.prefs).not.toHaveBeenCalled();
  });

  it("브라우저 미지원·iOS 미설치·권한 차단은 각각 이유를 밝히고 기도·가정예배·공지는 그대로 준비 중", async () => {
    const cases = [
      { setup: () => vi.unstubAllGlobals(), text: "이 브라우저는 알림을 지원하지 않아요" },
      {
        setup: () => {
          stubReadyBrowser();
          Object.defineProperty(navigator, "userAgent", {
            value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
            configurable: true,
          });
          vi.stubGlobal(
            "matchMedia",
            vi.fn(() => ({ matches: false })),
          );
        },
        text: "홈 화면에 추가한 뒤 켤 수 있어요",
      },
      { setup: () => stubReadyBrowser("denied"), text: "브라우저 설정에서 알림을 허용해 주세요" },
    ];
    for (const { setup, text } of cases) {
      setup();
      const view = render(wrap(<SettingsScreen />));
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: READ_TOGGLE })).toBeDisabled();
      for (const label of SOON_TOGGLES) expect(screen.getByRole("button", { name: label })).toBeDisabled();
      view.unmount();
    }
  });

  it("비로그인은 켜기 대신 로그인 안내를 본다", async () => {
    vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "로그인이 필요합니다" }));
    render(wrap(<SettingsScreen />));

    expect(await screen.findByRole("link", { name: "로그인하면 알림을 켤 수 있어요" })).toHaveAttribute(
      "href",
      "/hoondok/onboarding?returnTo=%2Fhoondok%2Fsettings",
    );
    expect(screen.getByRole("button", { name: READ_TOGGLE })).toBeDisabled();
    expect(notificationsAPI.prefs).not.toHaveBeenCalled();
  });
});
