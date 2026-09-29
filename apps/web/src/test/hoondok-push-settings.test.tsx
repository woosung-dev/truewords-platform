import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { SAVED_TEXT } from "@/features/hoondok/notifications/components/read-notification-card";
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
  serverPrefs = { read_enabled: false, read_time: "06:00", subscription_count: 0 };
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
    // 권한 요청은 클릭 핸들러 안에서 바로 시작된다 — await 뒤(mutationFn 안)면 iOS 가 제스처 밖 요청으로 볼 수 있다
    expect(Notification.requestPermission).toHaveBeenCalledOnce();

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
    serverPrefs = { read_enabled: true, read_time: "06:00", subscription_count: 1 };
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
    });
    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "false"));
  });

  it("시간은 구독을 건드리지 않고 PUT 만 한다", async () => {
    render(wrap(<SettingsScreen />));
    // 서버 설정을 읽기 전(기본값 = 꺼짐)에는 시각 칸이 비활성이다 — 켜짐을 확인한 뒤 바꾼다
    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "true"));
    const time = screen.getByLabelText("훈독하기 알림 시간");

    fireEvent.change(time, { target: { value: "05:30" } });
    await waitFor(() =>
      expect(notificationsAPI.savePrefs).toHaveBeenCalledWith({
        read_enabled: true,
        read_time: "05:30",
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

describe("훈독 시간 고르기 (추천 4칸 + 직접 정하기)", () => {
  beforeEach(() => {
    serverPrefs = { read_enabled: true, read_time: "06:00", subscription_count: 1 };
    pushManager.getSubscription.mockResolvedValue(subscription);
  });

  const radio = (name: RegExp) => screen.getByRole("radio", { name });
  const summary = () => screen.getByText(/에 알려드려요/).closest("p");

  it("켠 상태는 radio 4칸 + 직접 정하기이고, 칸에 없는 기본 06:00 은 '직접 정하기' 로 보인다", async () => {
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "true"));

    const group = screen.getByRole("group", { name: "언제 알려 드릴까요?" });
    expect(within(group).getAllByRole("radio")).toHaveLength(5);
    for (const name of [/새벽\s*오전 5:30/, /아침\s*오전 7:30/, /점심\s*오후 12:30/, /저녁\s*오후 9:30/]) {
      expect(radio(name)).not.toBeChecked();
    }
    expect(radio(/직접 정하기/)).toBeChecked();
    expect(screen.getByLabelText("훈독하기 알림 시간")).toHaveValue("06:00");
    expect(summary()).toHaveAttribute("role", "status");
    expect(summary()).toHaveTextContent("매일 오전 6:00에 알려드려요");
    // 불러오기만 해서는 저장하지 않는다
    expect(notificationsAPI.savePrefs).not.toHaveBeenCalled();
    expect(screen.queryByText(SAVED_TEXT)).toBeNull();
  });

  it("칸을 고르면 PUT 한 번으로 바로 저장하고 '저장했어요' 와 요약 문장을 보인다 — 권한·구독은 건드리지 않는다", async () => {
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(radio(/새벽\s*오전 5:30/));

    expect(await screen.findByText(SAVED_TEXT)).toBeInTheDocument();
    expect(notificationsAPI.savePrefs).toHaveBeenCalledOnce();
    expect(notificationsAPI.savePrefs).toHaveBeenCalledWith({ read_enabled: true, read_time: "05:30" });
    expect(summary()).toHaveTextContent("매일 오전 5:30에 알려드려요");
    expect(screen.getByText(SAVED_TEXT).closest('[role="status"]')).not.toBeNull();
    expect(radio(/새벽\s*오전 5:30/)).toBeChecked();
    expect(radio(/직접 정하기/)).not.toBeChecked();
    expect(screen.queryByLabelText("훈독하기 알림 시간")).toBeNull();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(notificationsAPI.subscribe).not.toHaveBeenCalled();
    expect(notificationsAPI.unsubscribe).not.toHaveBeenCalled();

    // 이미 고른 칸을 다시 눌러도 더 보내지 않는다
    fireEvent.click(radio(/새벽\s*오전 5:30/));
    expect(notificationsAPI.savePrefs).toHaveBeenCalledOnce();
  });

  it("직접 정하기는 여는 것만으로는 저장하지 않고, 시각을 바꾸면 그 값으로 한 번 저장한다", async () => {
    serverPrefs = { ...serverPrefs, read_time: "07:30" };
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(radio(/아침\s*오전 7:30/)).toBeChecked());
    expect(screen.queryByLabelText("훈독하기 알림 시간")).toBeNull();

    fireEvent.click(radio(/직접 정하기/));
    const time = screen.getByLabelText("훈독하기 알림 시간");
    expect(time).toHaveValue("07:30");
    expect(notificationsAPI.savePrefs).not.toHaveBeenCalled();

    fireEvent.change(time, { target: { value: "21:00" } });
    expect(await screen.findByText(SAVED_TEXT)).toBeInTheDocument();
    expect(notificationsAPI.savePrefs).toHaveBeenCalledOnce();
    expect(notificationsAPI.savePrefs).toHaveBeenCalledWith({ read_enabled: true, read_time: "21:00" });
    expect(summary()).toHaveTextContent("매일 오후 9:00에 알려드려요");
    expect(radio(/직접 정하기/)).toBeChecked();
  });

  it("저장에 실패하면 원래 칸으로 돌아가고 '저장했어요' 없이 한 줄 안내만 남는다", async () => {
    vi.mocked(notificationsAPI.savePrefs).mockRejectedValueOnce(new ApiError(503, { message: "down" }));
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(radio(/점심\s*오후 12:30/));

    expect(await screen.findByRole("alert")).toHaveTextContent(PUSH_MESSAGES.failed);
    expect(radio(/직접 정하기/)).toBeChecked();
    expect(radio(/점심\s*오후 12:30/)).not.toBeChecked();
    expect(summary()).toHaveTextContent("매일 오전 6:00에 알려드려요");
    expect(screen.queryByText(SAVED_TEXT)).toBeNull();
  });

  it("끄면 칸이 모두 비활성이 되고 요약 문장이 사라진다", async () => {
    render(wrap(<SettingsScreen />));
    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(readToggle());

    await waitFor(() => expect(readToggle()).toHaveAttribute("aria-pressed", "false"));
    for (const item of screen.getAllByRole("radio")) expect(item).toBeDisabled();
    expect(screen.getByLabelText("훈독하기 알림 시간")).toBeDisabled();
    expect(screen.queryByText(/에 알려드려요/)).toBeNull();
  });
});

describe("켤 수 없는 상태", () => {
  it("서버 설정이 없으면 훈독하기도 '준비 중' 이다 (그 밖의 알림 · 조용한 시간과 함께 3곳)", async () => {
    vi.mocked(notificationsAPI.config).mockResolvedValue({ enabled: false, public_key: null });
    render(wrap(<SettingsScreen />));

    await waitFor(() => expect(screen.getAllByText("준비 중")).toHaveLength(3));
    const toggle = screen.getByRole("button", { name: READ_TOGGLE });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(notificationsAPI.prefs).not.toHaveBeenCalled();
  });

  it("브라우저 미지원·iOS 미설치·권한 차단은 각각 이유를 밝히고 시각 칸을 싣지 않는다", async () => {
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
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
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
