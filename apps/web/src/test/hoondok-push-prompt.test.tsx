import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 알림 받기 제안 카드(PLAN-HD-006 후속) + 인앱 브라우저 안내. 정책은 순수 함수 표로, 카드는 설정 화면 테스트와 같은
// API 모듈 mock 위에서 권한 → 구독 → 저장까지 본다. 인앱 판정은 UA 표로 본다.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/hoondok",
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

import {
  HoondokInAppBrowserBanner,
  INAPP_REDIRECT_KEY,
  KAKAO_BANNER_TITLE,
  KAKAO_OPEN_LABEL,
  OTHER_BANNER_BODY,
  OTHER_BANNER_TITLE,
} from "@/features/hoondok/install/components/in-app-browser-banner";
import { INSTALL_CARD_BODY } from "@/features/hoondok/install/components/install-card";
import { externalNavigation, inAppBrowser, kakaoOpenExternalUrl } from "@/features/hoondok/install/platform";
import { markInstallEligible } from "@/features/hoondok/install/storage";
import { notificationsAPI } from "@/features/hoondok/notifications/api";
import {
  PUSH_PROMPT_IOS_TITLE,
  PUSH_PROMPT_TITLE,
  PushPromptCard,
} from "@/features/hoondok/notifications/components/push-prompt-card";
import { type PushPromptInput, pushPromptVariant } from "@/features/hoondok/notifications/push-prompt-policy";
import {
  readPushPromptDeclines,
  readPushPromptLastDeclinedOn,
  recordPushPromptDecline,
} from "@/features/hoondok/notifications/push-prompt-storage";
import type { NotificationPrefs } from "@/features/hoondok/notifications/types";
import { PUSH_MESSAGES } from "@/features/hoondok/notifications/use-push-notifications";
import { formatKstDate } from "@/features/hoondok/today";
import { identityAPI } from "@/features/identity/api";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const PROMPT_KEY = "hoondok:push-prompt";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const KAKAO_IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5";
const KAKAO_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36;KAKAOTALK 2410800";
const INSTAGRAM_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91 (iPhone15,3; iOS 17_5; ko_KR; ko; scale=3.00; 1290x2796; 618023787)";
/** KST 오늘·어제 (YYYY-MM-DD) — "나중에" 날짜 비교용 */
const kstToday = () => formatKstDate().iso;
const kstYesterday = () => formatKstDate(new Date(Date.now() - 86_400_000)).iso;
const VAPID_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const ENDPOINT = "https://push.example/abc";

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

/** 켤 수 있는 데스크톱 브라우저. requestPermission 은 결과를 바꿔 끼울 수 있다. */
function stubReadyBrowser(result: NotificationPermission = "granted") {
  vi.stubGlobal("PushManager", class {});
  const notification = { permission: "default" as NotificationPermission, requestPermission: vi.fn() };
  notification.requestPermission.mockImplementation(async () => {
    notification.permission = result;
    return result;
  });
  vi.stubGlobal("Notification", notification);
  return stubNavigator({
    userAgent: DESKTOP_UA,
    maxTouchPoints: 0,
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrap(children: ReactNode, client = makeClient()) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * 계정·서버 설정·알림 설정 조회가 모두 끝날 때까지 기다린다. 숨김 단언이 "아직 불러오는 중이라 비어 있음" 으로
 * 거저 통과하지 않게 — 부를 조회(config·prefs)는 그 호출이 일어난 뒤 조회가 멈출 때까지 본다.
 * expectConfig=false 는 겉 컴포넌트가 속(알림 훅)을 마운트하지 않는 경우(비로그인·인앱)다.
 */
async function settle(
  client: QueryClient,
  { expectPrefs, expectConfig = true }: { expectPrefs: boolean; expectConfig?: boolean },
) {
  await waitFor(() => expect(identityAPI.me).toHaveBeenCalled());
  if (expectConfig) await waitFor(() => expect(notificationsAPI.config).toHaveBeenCalled());
  if (expectPrefs) await waitFor(() => expect(notificationsAPI.prefs).toHaveBeenCalled());
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    await Promise.resolve();
  });
}

let restoreNavigator = () => {};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  serverPrefs = { read_enabled: false, read_time: "06:00", subscription_count: 0 };
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
  vi.mocked(notificationsAPI.config).mockResolvedValue({ enabled: true, public_key: VAPID_KEY });
  vi.mocked(notificationsAPI.prefs).mockImplementation(async () => serverPrefs);
  vi.mocked(notificationsAPI.savePrefs).mockImplementation(async (body) => {
    serverPrefs = { ...serverPrefs, ...body };
    return serverPrefs;
  });
  vi.mocked(notificationsAPI.subscribe).mockResolvedValue({ id: "s1", endpoint: ENDPOINT, created_at: "2026-09-28" });
  restoreNavigator = stubReadyBrowser();
});
afterEach(() => {
  restoreNavigator();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pushPromptVariant — 노출 정책", () => {
  const base: PushPromptInput = {
    placement: "home",
    isSignedIn: true,
    isPrefsReady: true,
    isReadEnabled: false,
    support: "ready",
    declines: 0,
    isDeclinedToday: false,
    isReadDone: false,
    isInstallCardVisible: false,
  };

  it("로그인 · 꺼짐 · ready 면 홈에서 보인다", () => {
    expect(pushPromptVariant(base)).toBe("ready");
  });

  it.each<[string, Partial<PushPromptInput>]>([
    ["비로그인", { isSignedIn: false }],
    ["서버 설정을 아직 못 읽음", { isPrefsReady: false }],
    ["이미 켬", { isReadEnabled: true }],
    ["서버 설정 확인 중(support null)", { support: null }],
    ["준비 중(disabled)", { support: "disabled" }],
    ["미지원", { support: "unsupported" }],
    ["권한 차단", { support: "denied" }],
    // 인앱 브라우저는 detectPushSupport 가 unsupported 로 돌려준다 — 위 "미지원" 행이 그 경우다
    ["저장소를 아직 못 읽음(SSR)", { declines: null }],
    ["홈은 오늘 안 읽었으면 나중에 1번에 멈춘다", { declines: 1, isReadDone: false }],
    [
      "같은 날 나중에 뒤에는 오늘 읽었어도 다시 묻지 않는다(홈)",
      { declines: 1, isReadDone: true, isDeclinedToday: true },
    ],
    [
      "같은 날 나중에 뒤에는 오늘 읽었어도 다시 묻지 않는다(훈독 완료 뒤)",
      { placement: "after-read", declines: 1, isReadDone: true, isDeclinedToday: true },
    ],
  ])("숨김: %s", (_, patch) => {
    expect(pushPromptVariant({ ...base, ...patch })).toBe("hidden");
  });

  it("홈: 첫 방문(나중에 0)이거나, 나중에 1번이 오늘이 아니고 오늘 마쳤으면(미션 체크 즉시 완료 포함) 두 번째 기회", () => {
    expect(pushPromptVariant({ ...base, declines: 0, isReadDone: false })).toBe("ready");
    expect(pushPromptVariant({ ...base, declines: 0, isReadDone: true })).toBe("ready");
    expect(pushPromptVariant({ ...base, declines: 1, isReadDone: false })).toBe("hidden");
    expect(pushPromptVariant({ ...base, declines: 1, isReadDone: true })).toBe("ready");
    expect(pushPromptVariant({ ...base, declines: 1, isReadDone: true, isDeclinedToday: true })).toBe("hidden");
    expect(pushPromptVariant({ ...base, declines: 2, isReadDone: true })).toBe("hidden");
  });

  it("훈독 완료 뒤 자리는 오늘 마쳤고, 나중에 0번이거나 1번이 오늘이 아닐 때만", () => {
    const afterRead = { ...base, placement: "after-read" as const };
    expect(pushPromptVariant({ ...afterRead, isReadDone: false })).toBe("hidden");
    expect(pushPromptVariant({ ...afterRead, isReadDone: true, declines: 0 })).toBe("ready");
    expect(pushPromptVariant({ ...afterRead, isReadDone: true, declines: 1 })).toBe("ready");
    expect(pushPromptVariant({ ...afterRead, isReadDone: true, declines: 1, isDeclinedToday: true })).toBe("hidden");
    expect(pushPromptVariant({ ...afterRead, isReadDone: true, declines: 2 })).toBe("hidden");
    expect(pushPromptVariant({ ...afterRead, isReadDone: true, declines: 5 })).toBe("hidden");
  });

  it("iOS 미설치는 설치 안내 변형이고, 홈에 설치 카드가 이미 보이면 겹치지 않는다", () => {
    const ios = { ...base, support: "ios-not-installed" as const };
    expect(pushPromptVariant(ios)).toBe("ios");
    expect(pushPromptVariant({ ...ios, isInstallCardVisible: true })).toBe("hidden");
    // 훈독하기 화면에는 설치 카드가 없다 — 겹칠 일이 없으니 그대로 보인다
    expect(pushPromptVariant({ ...ios, placement: "after-read", isReadDone: true, isInstallCardVisible: true })).toBe(
      "ios",
    );
  });
});

describe("push-prompt-storage — localStorage 한 키", () => {
  it("나중에 횟수와 KST 날짜를 {declines, lastDeclinedOn} 로 쌓고, 깨진 값은 0·null 로 본다", () => {
    expect(readPushPromptDeclines()).toBe(0);
    expect(readPushPromptLastDeclinedOn()).toBeNull();
    recordPushPromptDecline();
    recordPushPromptDecline();
    expect(JSON.parse(localStorage.getItem(PROMPT_KEY) ?? "null")).toEqual({ declines: 2, lastDeclinedOn: kstToday() });
    expect(readPushPromptDeclines()).toBe(2);
    expect(readPushPromptLastDeclinedOn()).toBe(kstToday());
    for (const broken of ["not-json", '{"declines":-1}', '{"declines":1.5}', '"2"', "null"]) {
      localStorage.setItem(PROMPT_KEY, broken);
      expect(readPushPromptDeclines()).toBe(0);
      expect(readPushPromptLastDeclinedOn()).toBeNull();
    }
    for (const badDate of ['{"declines":1,"lastDeclinedOn":20260928}', '{"declines":1,"lastDeclinedOn":"어제"}']) {
      localStorage.setItem(PROMPT_KEY, badDate);
      expect(readPushPromptDeclines()).toBe(1);
      expect(readPushPromptLastDeclinedOn()).toBeNull();
    }
  });

  it('옛 저장값 {"declines":n} 은 날짜 없음으로 읽고, 다음 나중에서 날짜를 붙여 이어 쌓는다', () => {
    localStorage.setItem(PROMPT_KEY, '{"declines":1}');
    expect(readPushPromptDeclines()).toBe(1);
    expect(readPushPromptLastDeclinedOn()).toBeNull();
    recordPushPromptDecline();
    expect(JSON.parse(localStorage.getItem(PROMPT_KEY) ?? "null")).toEqual({ declines: 2, lastDeclinedOn: kstToday() });
  });

  it("저장소가 던져도 예외 없이 0 이고 기록도 조용히 넘어간다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPushPromptDeclines()).toBe(0);
    expect(() => recordPushPromptDecline()).not.toThrow();
  });
});

describe("PushPromptCard — ready", () => {
  it("알림 받기: 권한 요청이 클릭 안에서 동기적으로 시작되고 → 구독 → PUT → 켠 시각 안내", async () => {
    render(wrap(<PushPromptCard placement="home" />));
    expect(await screen.findByRole("heading", { name: PUSH_PROMPT_TITLE })).toBeInTheDocument();
    expect(screen.getByText("잠금 화면에는 '오늘의 책갈피가 꽂혀 있어요' 처럼 보여요")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "알림 받기" }));
    // await 없이 바로 — mutationFn 안(비동기)이 아니라 클릭 핸들러 안에서 불렸다는 뜻이다 (iOS 제스처 규칙)
    expect(Notification.requestPermission).toHaveBeenCalledOnce();

    expect(await screen.findByText("매일 오전 6:00에 알려 드릴게요")).toBeInTheDocument();
    expect(notificationsAPI.subscribe).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      keys: { p256dh: "p256", auth: "auth" },
      user_agent: DESKTOP_UA,
    });
    expect(notificationsAPI.savePrefs).toHaveBeenCalledWith({
      read_enabled: true,
      read_time: "06:00",
    });
    expect(screen.getByRole("link", { name: "시각은 설정에서 바꿀 수 있어요" })).toHaveAttribute(
      "href",
      "/hoondok/settings",
    );
    expect(screen.queryByRole("button", { name: "알림 받기" })).toBeNull();
  });

  it("훈독 완료 뒤 자리에서 켜면 오늘은 건너뛰므로 '내일' 로 안내한다", async () => {
    serverPrefs = { ...serverPrefs, read_time: "05:30" };
    render(wrap(<PushPromptCard placement="after-read" isReadDone />));
    fireEvent.click(await screen.findByRole("button", { name: "알림 받기" }));
    expect(await screen.findByText("내일 오전 5:30에 알려 드릴게요")).toBeInTheDocument();
  });

  it("권한을 거절하면 기존 안내 문구가 이 자리에 남고, 다시 물을 수 없으니 알림 받기 버튼은 사라진다", async () => {
    restoreNavigator();
    restoreNavigator = stubReadyBrowser("denied");
    render(wrap(<PushPromptCard placement="home" />));
    fireEvent.click(await screen.findByRole("button", { name: "알림 받기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(PUSH_MESSAGES.permission);
    expect(screen.queryByRole("button", { name: "알림 받기" })).toBeNull();
    expect(screen.getByRole("button", { name: "나중에" })).toBeInTheDocument();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(notificationsAPI.savePrefs).not.toHaveBeenCalled();
  });

  it("나중에: 같은 날에는 어느 자리에서도 다시 묻지 않고, 다음 날 오늘 마친 뒤에 한 번 더 묻는다", async () => {
    const home = render(wrap(<PushPromptCard placement="home" />));
    fireEvent.click(await screen.findByRole("button", { name: "나중에" }));
    expect(screen.queryByRole("heading", { name: PUSH_PROMPT_TITLE })).toBeNull();
    expect(JSON.parse(localStorage.getItem(PROMPT_KEY) ?? "null")).toEqual({ declines: 1, lastDeclinedOn: kstToday() });
    home.unmount();

    // 같은 날 홈을 다시 열어도, 오늘 훈독을 마쳐도 보이지 않는다
    for (const element of [
      <PushPromptCard key="home" placement="home" />,
      <PushPromptCard key="home-done" placement="home" isReadDone />,
      <PushPromptCard key="after-read" placement="after-read" isReadDone />,
    ]) {
      const sameDayClient = makeClient();
      const sameDay = render(wrap(element, sameDayClient));
      await settle(sameDayClient, { expectPrefs: true });
      expect(sameDay.container).toBeEmptyDOMElement();
      sameDay.unmount();
    }

    // 다음 날(첫 나중에가 어제) 훈독을 마친 뒤에는 한 번 더 — 여기서도 나중에면 2번째라 이후 설정에서만
    localStorage.setItem(PROMPT_KEY, JSON.stringify({ declines: 1, lastDeclinedOn: kstYesterday() }));
    const afterRead = render(wrap(<PushPromptCard placement="after-read" isReadDone />));
    fireEvent.click(await screen.findByRole("button", { name: "나중에" }));
    expect(screen.queryByRole("heading", { name: PUSH_PROMPT_TITLE })).toBeNull();
    expect(JSON.parse(localStorage.getItem(PROMPT_KEY) ?? "null")).toEqual({ declines: 2, lastDeclinedOn: kstToday() });
    afterRead.unmount();

    // 상한(2번)은 날짜와 무관하다 — 다음 날이어도 더 묻지 않는다
    localStorage.setItem(PROMPT_KEY, JSON.stringify({ declines: 2, lastDeclinedOn: kstYesterday() }));

    const lastClient = makeClient();
    const last = render(wrap(<PushPromptCard placement="after-read" isReadDone />, lastClient));
    await settle(lastClient, { expectPrefs: true });
    expect(last.container).toBeEmptyDOMElement();
    last.unmount();

    // 상한(2번)에 닿았으면 홈에서 오늘 마쳤어도 더 묻지 않는다
    const homeDoneClient = makeClient();
    const homeDone = render(wrap(<PushPromptCard placement="home" isReadDone />, homeDoneClient));
    await settle(homeDoneClient, { expectPrefs: true });
    expect(homeDone.container).toBeEmptyDOMElement();
  });

  it("다음 날 홈 미션 체크로 오늘 마치면 홈 자리에서 두 번째 기회가 온다", async () => {
    localStorage.setItem(PROMPT_KEY, JSON.stringify({ declines: 1, lastDeclinedOn: kstYesterday() }));
    const client = makeClient();
    const view = render(wrap(<PushPromptCard placement="home" />, client));
    await settle(client, { expectPrefs: true });
    expect(view.container).toBeEmptyDOMElement();
    // 같은 자리에서 오늘 완료가 되면(미션 카드 즉시 완료) 그대로 나타난다
    view.rerender(wrap(<PushPromptCard placement="home" isReadDone />, client));
    expect(await screen.findByRole("heading", { name: PUSH_PROMPT_TITLE })).toBeInTheDocument();
  });

  it('옛 저장값 {"declines":1}(날짜 없음)은 같은 날로 보지 않아 두 번째 기회를 막지 않는다', async () => {
    localStorage.setItem(PROMPT_KEY, '{"declines":1}');
    render(wrap(<PushPromptCard placement="after-read" isReadDone />));
    expect(await screen.findByRole("heading", { name: PUSH_PROMPT_TITLE })).toBeInTheDocument();
  });

  it("저장소가 막혀 있어도 카드는 그려지고 나중에를 누르면 그 자리에서 사라진다", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(wrap(<PushPromptCard placement="home" />));
    fireEvent.click(await screen.findByRole("button", { name: "나중에" }));
    expect(screen.queryByRole("heading", { name: PUSH_PROMPT_TITLE })).toBeNull();
  });
});

describe("PushPromptCard — 그리지 않는 경우", () => {
  async function expectNothing(element: ReactNode, options: { expectPrefs: boolean; expectConfig?: boolean }) {
    vi.clearAllMocks();
    const client = makeClient();
    const view = render(wrap(element, client));
    await settle(client, options);
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
  }

  it("이미 켠 계정 · 서버 준비 중 · 비로그인 · 오늘 아직 안 읽음(훈독 완료 뒤 자리)", async () => {
    serverPrefs = { ...serverPrefs, read_enabled: true, subscription_count: 1 };
    await expectNothing(<PushPromptCard placement="home" />, { expectPrefs: true });

    serverPrefs = { ...serverPrefs, read_enabled: false };
    vi.mocked(notificationsAPI.config).mockResolvedValue({ enabled: false, public_key: null });
    await expectNothing(<PushPromptCard placement="home" />, { expectPrefs: false });

    vi.mocked(notificationsAPI.config).mockResolvedValue({ enabled: true, public_key: VAPID_KEY });
    vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "로그인이 필요합니다" }));
    await expectNothing(<PushPromptCard placement="home" />, { expectPrefs: false, expectConfig: false });
    // 비로그인 홈 방문은 알림 조회를 하나도 만들지 않는다 (겉 컴포넌트가 속을 마운트하지 않는다)
    expect(notificationsAPI.config).not.toHaveBeenCalled();
    expect(notificationsAPI.prefs).not.toHaveBeenCalled();

    vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
    await expectNothing(<PushPromptCard placement="after-read" />, { expectPrefs: true });

    // 대조군 — 같은 준비에서 홈 자리는 실제로 보인다(위 숨김이 "불러오는 중" 이 아니었다는 확인)
    render(wrap(<PushPromptCard placement="home" />));
    expect(await screen.findByRole("heading", { name: PUSH_PROMPT_TITLE })).toBeInTheDocument();
  });

  it("카카오톡 인앱 브라우저에서는 알림 제안도, 알림 조회도 하지 않는다 (배너가 바깥 브라우저로 보낸다)", async () => {
    const restoreUa = stubNavigator({ userAgent: KAKAO_ANDROID_UA });
    await expectNothing(<PushPromptCard placement="home" />, { expectPrefs: false, expectConfig: false });
    expect(notificationsAPI.config).not.toHaveBeenCalled();
    expect(notificationsAPI.prefs).not.toHaveBeenCalled();
    restoreUa();
  });
});

describe("PushPromptCard — iOS 사파리 탭", () => {
  beforeEach(() => {
    // 실제 iOS 사파리 탭처럼 푸시 API 가 하나도 없다
    restoreNavigator();
    vi.unstubAllGlobals();
    restoreNavigator = stubNavigator({ userAgent: IOS_SAFARI_UA, maxTouchPoints: 5 });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
  });

  it("알림 대신 홈 화면에 추가하라는 안내 — 설치 카드의 iOS 단계 문구를 그대로 쓴다", async () => {
    render(wrap(<PushPromptCard placement="home" />));
    expect(await screen.findByRole("heading", { name: PUSH_PROMPT_IOS_TITLE })).toBeInTheDocument();
    expect(screen.getByText(INSTALL_CARD_BODY.ios)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "알림 받기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "나중에" }));
    expect(screen.queryByRole("heading", { name: PUSH_PROMPT_IOS_TITLE })).toBeNull();
    expect(readPushPromptDeclines()).toBe(1);
  });

  it("홈에 설치 안내 카드가 이미 보이면(첫 완료 뒤) 같은 안내를 겹쳐 싣지 않는다", async () => {
    markInstallEligible();
    const client = makeClient();
    const view = render(wrap(<PushPromptCard placement="home" />, client));
    await settle(client, { expectPrefs: true });
    expect(view.container).toBeEmptyDOMElement();
  });
});

describe("inAppBrowser — UA 표", () => {
  it.each<[string, string, "kakaotalk" | "other" | null]>([
    ["카카오톡 iOS", KAKAO_IOS_UA, "kakaotalk"],
    ["카카오톡 Android", KAKAO_ANDROID_UA, "kakaotalk"],
    [
      "네이버 앱",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.5.1; 15PRO)",
      "other",
    ],
    ["인스타그램", INSTAGRAM_UA, "other"],
    [
      "페이스북",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.108;FBBV/620172467;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/ko_KR;FBOP/80]",
      "other",
    ],
    [
      "라인",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0",
      "other",
    ],
    [
      "다음 앱",
      "Mozilla/5.0 (Linux; Android 14; SM-S918N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 DaumApps/5.7.2",
      "other",
    ],
    ["iOS 사파리", IOS_SAFARI_UA, null],
    [
      "iOS 크롬",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
      null,
    ],
    [
      "안드로이드 크롬",
      "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.134 Mobile Safari/537.36",
      null,
    ],
    [
      "삼성 인터넷",
      "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
      null,
    ],
    [
      "네이버 웨일",
      "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Whale/3.26.244.14 Mobile Safari/537.36",
      null,
    ],
    [
      "Playwright 헤드리스 Chromium",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36",
      null,
    ],
    ["데스크톱 크롬", DESKTOP_UA, null],
  ])("%s", (_, userAgent, expected) => {
    expect(inAppBrowser(userAgent)).toBe(expected);
  });

  it("외부 브라우저 스킴은 현재 주소 전체를 인코딩해 싣는다", () => {
    expect(kakaoOpenExternalUrl("https://truewords.woosung.dev/hoondok/groups/join?code=AB12&x=1")).toBe(
      "kakaotalk://web/openExternal?url=https%3A%2F%2Ftruewords.woosung.dev%2Fhoondok%2Fgroups%2Fjoin%3Fcode%3DAB12%26x%3D1",
    );
  });
});

describe("HoondokInAppBrowserBanner", () => {
  // jsdom 은 kakaotalk:// 스킴 이동을 수행하지 못한다 — 이동 한 곳(externalNavigation.go)만 가로챈다
  function spyGo() {
    return vi.spyOn(externalNavigation, "go").mockImplementation(() => {});
  }

  it("일반 브라우저(헤드리스 포함)와 SSR 첫 렌더에서는 아무것도 그리지 않는다", () => {
    const go = spyGo();
    const view = render(<HoondokInAppBrowserBanner />);
    expect(view.container).toBeEmptyDOMElement();
    expect(go).not.toHaveBeenCalled();
    view.unmount();

    // 서버 렌더는 UA 를 모른다 — 인앱 UA 여도 첫 HTML 은 비어 있어야 hydration 이 어긋나지 않는다
    const restoreUa = stubNavigator({ userAgent: KAKAO_IOS_UA });
    expect(renderToString(<HoondokInAppBrowserBanner />)).toBe("");
    expect(go).not.toHaveBeenCalled();
    restoreUa();
  });

  it("카카오톡: 세션당 한 번 외부 브라우저로 넘기고, 남은 배너의 버튼으로 다시 열 수 있다", () => {
    const restoreUa = stubNavigator({ userAgent: KAKAO_IOS_UA, maxTouchPoints: 5 });
    const go = spyGo();
    const expected = kakaoOpenExternalUrl(window.location.href);

    const first = render(<HoondokInAppBrowserBanner />);
    expect(go).toHaveBeenCalledOnce();
    expect(go).toHaveBeenCalledWith(expected);
    expect(sessionStorage.getItem(INAPP_REDIRECT_KEY)).toBe("1");
    expect(screen.getByText(KAKAO_BANNER_TITLE)).toBeInTheDocument();
    first.unmount();

    // 같은 세션에서 다시 열어도 자동 전환은 하지 않는다
    render(<HoondokInAppBrowserBanner />);
    expect(go).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: KAKAO_OPEN_LABEL }));
    expect(go).toHaveBeenCalledTimes(2);
    expect(go).toHaveBeenLastCalledWith(expected);

    fireEvent.click(screen.getByRole("button", { name: "안내 닫기" }));
    expect(screen.queryByText(KAKAO_BANNER_TITLE)).toBeNull();
    restoreUa();
  });

  it("카카오톡 Android 도 브라우저 이름 없이 같은 '기본 브라우저로 열기', 세션 저장소가 막혀 있으면 자동 전환하지 않는다", () => {
    const restoreUa = stubNavigator({ userAgent: KAKAO_ANDROID_UA, maxTouchPoints: 5 });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const go = spyGo();
    render(<HoondokInAppBrowserBanner />);
    expect(go).not.toHaveBeenCalled();
    // 갤럭시 기본 브라우저는 삼성 인터넷일 수 있다 — 특정 브라우저 이름을 약속하지 않는다
    expect(screen.queryByRole("button", { name: /Chrome|Safari|삼성/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: KAKAO_OPEN_LABEL }));
    expect(go).toHaveBeenCalledOnce();
    restoreUa();
  });

  it("기타 인앱: 메뉴 안내 + 링크 복사(실패해도 안내만)", async () => {
    const restoreUa = stubNavigator({ userAgent: INSTAGRAM_UA });
    const writeText = vi.fn(async () => undefined);
    const restoreClipboard = stubNavigator({ clipboard: { writeText } });
    const go = spyGo();
    render(<HoondokInAppBrowserBanner />);

    expect(screen.getByText(OTHER_BANNER_TITLE)).toBeInTheDocument();
    // 앱마다 메뉴 위치가 달라 "우측 상단" 처럼 위치를 특정하지 않는다
    expect(screen.getByText(OTHER_BANNER_BODY)).toBeInTheDocument();
    expect(screen.queryByText(/우측|상단|하단/)).toBeNull();
    expect(go).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "링크 복사" }));
    expect(await screen.findByRole("status")).toHaveTextContent("링크를 복사했어요");
    expect(writeText).toHaveBeenCalledWith(window.location.href);

    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "링크 복사" }));
    expect(await screen.findByText(/복사하지 못했어요/)).toBeInTheDocument();
    restoreClipboard();
    restoreUa();
  });
});
