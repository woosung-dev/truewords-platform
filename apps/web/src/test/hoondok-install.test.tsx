import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/hoondok/read",
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
vi.mock("@/features/hoondok/missions-api", () => ({
  missionsAPI: { complete: vi.fn(), summary: vi.fn() },
}));

import { ReadCompleteButton } from "@/features/hoondok/components/read-complete-button";
import { INSTALL_CARD_TITLE, InstallCard } from "@/features/hoondok/install/components/install-card";
import { HoondokInstallPromptListener } from "@/features/hoondok/install/components/install-prompt-listener";
import { isIos, isStandalone } from "@/features/hoondok/install/platform";
import { consumeDeferredPrompt, getDeferredPrompt } from "@/features/hoondok/install/prompt-store";
import {
  dismissInstallCard,
  INSTALL_DISMISS_DAYS,
  markInstallEligible,
  markInstalled,
  readInstallState,
} from "@/features/hoondok/install/storage";
import { getInstallVariant } from "@/features/hoondok/install/use-install-card";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { writePending } from "@/features/hoondok/pending";
import { formatKstDate } from "@/features/hoondok/today";
import { identityAPI } from "@/features/identity/api";

const KEY_ELIGIBLE = "hoondok:install:eligible";
const KEY_HIDDEN_UNTIL = "hoondok:install:hidden-until";
const KEY_INSTALLED = "hoondok:install:installed";
const DAY = 24 * 60 * 60 * 1000;
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPADOS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const TODAY = formatKstDate().iso;
const EMPTY_SUMMARY = {
  today: { read: false, pray: false, study: false },
  streak_days: 0,
  best_streak_days: 0,
  total_days: 0,
  week: [],
};

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** jsdom 의 navigator 속성은 프로토타입 getter 라 own property 로 덮고 끝나면 지운다 (hoondok-pwa.test 방식). */
function stubNavigator(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props))
    Object.defineProperty(navigator, key, { value, configurable: true });
  return () => {
    for (const key of Object.keys(props)) Reflect.deleteProperty(navigator, key);
  };
}

/** Chromium 이 발사하는 beforeinstallprompt 를 흉내낸다 — prompt() 와 userChoice 만 있으면 된다. */
function fireInstallPrompt(outcome: "accepted" | "dismissed") {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
  window.dispatchEvent(event);
  return { event, prompt };
}

function loggedIn() {
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
  vi.mocked(missionsAPI.summary).mockResolvedValue(EMPTY_SUMMARY);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => {
  consumeDeferredPrompt();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("install/storage (localStorage 3키)", () => {
  it("자격 · 30일 숨김 · 설치 완료를 각각 읽고, 숨김은 기한이 지나면 풀린다", () => {
    const now = Date.parse("2026-09-19T00:00:00Z");
    expect(readInstallState(now)).toEqual({ isEligible: false, isHidden: false, isInstalled: false });

    markInstallEligible();
    expect(localStorage.getItem(KEY_ELIGIBLE)).toBe("1");
    expect(readInstallState(now).isEligible).toBe(true);

    dismissInstallCard(INSTALL_DISMISS_DAYS, now);
    expect(localStorage.getItem(KEY_HIDDEN_UNTIL)).toBe(new Date(now + 30 * DAY).toISOString());
    expect(readInstallState(now).isHidden).toBe(true);
    expect(readInstallState(now + 30 * DAY - 1).isHidden).toBe(true);
    expect(readInstallState(now + 30 * DAY).isHidden).toBe(false);

    markInstalled();
    expect(localStorage.getItem(KEY_INSTALLED)).toBe("1");
    expect(readInstallState(now).isInstalled).toBe(true);
  });

  it("깨진 hidden-until 은 숨김이 아니고, 저장소가 던져도 예외 없이 '없음' 으로 본다", () => {
    localStorage.setItem(KEY_HIDDEN_UNTIL, "not-a-date");
    expect(readInstallState().isHidden).toBe(false);

    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readInstallState()).toEqual({ isEligible: false, isHidden: false, isInstalled: false });
    expect(() => markInstallEligible()).not.toThrow();
    spy.mockRestore();
  });
});

describe("install/platform + getInstallVariant", () => {
  it("자격 전에는 hidden, 자격만 있는 데스크톱은 manual (prompt 미캡처)", () => {
    const restore = stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    try {
      expect(getInstallVariant()).toBe("hidden");
      markInstallEligible();
      expect(getInstallVariant()).toBe("manual");
      dismissInstallCard();
      expect(getInstallVariant()).toBe("hidden");
    } finally {
      restore();
    }
  });

  it("standalone(display-mode 또는 navigator.standalone)이면 자격이 있어도 hidden", () => {
    markInstallEligible();
    const restore = stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    try {
      expect(isStandalone()).toBe(false); // jsdom: matchMedia 없음 → try/catch 로 false
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: true })),
      );
      expect(isStandalone()).toBe(true);
      expect(getInstallVariant()).toBe("hidden");
      vi.unstubAllGlobals();

      const restoreStandalone = stubNavigator({ standalone: true });
      try {
        expect(isStandalone()).toBe(true);
        expect(getInstallVariant()).toBe("hidden");
      } finally {
        restoreStandalone();
      }
    } finally {
      restore();
    }
  });

  it("iPhone UA 와 iPadOS(Macintosh UA + 터치)는 ios, 터치 없는 Mac 은 아니다", () => {
    expect(isIos(IPHONE_UA, 5)).toBe(true);
    expect(isIos(IPADOS_UA, 5)).toBe(true);
    expect(isIos(IPADOS_UA, 0)).toBe(false);
    expect(isIos(DESKTOP_UA, 10)).toBe(false);

    markInstallEligible();
    const restore = stubNavigator({ userAgent: IPHONE_UA, maxTouchPoints: 5 });
    try {
      expect(getInstallVariant()).toBe("ios");
    } finally {
      restore();
    }
  });

  it("beforeinstallprompt 를 잡으면 prompt, 소비하면 manual 로 내려간다", () => {
    markInstallEligible();
    const restore = stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    try {
      render(<HoondokInstallPromptListener />);
      const { event } = fireInstallPrompt("dismissed");
      expect(event.defaultPrevented).toBe(true); // Chrome Android 미니 인포바 억제
      expect(getDeferredPrompt()).toBe(event);
      expect(getInstallVariant()).toBe("prompt");
      expect(consumeDeferredPrompt()).toBe(event);
      expect(getInstallVariant()).toBe("manual");
    } finally {
      restore();
    }
  });
});

describe("InstallCard (홈 조건 렌더)", () => {
  it("자격 전에는 비어 있고, 자격을 얻으면 같은 트리에서 나타난다 (외부 저장소 구독)", async () => {
    const restore = stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    try {
      const { container } = render(<InstallCard />);
      expect(container.innerHTML).toBe("");
      markInstallEligible();
      expect(await screen.findByRole("heading", { name: INSTALL_CARD_TITLE })).toBeInTheDocument();
      expect(screen.getByText(/브라우저 메뉴의 '홈 화면에 추가'/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "지금 추가" })).toBeNull();
      expect(screen.queryByText(/알림/)).toBeNull(); // 알림 문구는 Phase 4
    } finally {
      restore();
    }
  });

  it("prompt 변형: 지금 추가 → prompt() 호출, 수락하면 installed 키 + 카드 사라짐", async () => {
    const restore = stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    try {
      render(
        <>
          <HoondokInstallPromptListener />
          <InstallCard />
        </>,
      );
      const { prompt } = fireInstallPrompt("accepted");
      markInstallEligible();
      expect(await screen.findByText("앱처럼 설치해 두면 주소창 없이 바로 훈독할 수 있어요.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "지금 추가" }));
      await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
      await waitFor(() => expect(localStorage.getItem(KEY_INSTALLED)).toBe("1"));
      await waitFor(() => expect(screen.queryByRole("heading", { name: INSTALL_CARD_TITLE })).toBeNull());
      expect(getDeferredPrompt()).toBeNull();
    } finally {
      restore();
    }
  });

  it("prompt 변형: 거절하면 installed 없이 manual 안내로 내려간다", async () => {
    const restore = stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    try {
      render(
        <>
          <HoondokInstallPromptListener />
          <InstallCard />
        </>,
      );
      const { prompt } = fireInstallPrompt("dismissed");
      markInstallEligible();
      fireEvent.click(await screen.findByRole("button", { name: "지금 추가" }));
      await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
      expect(await screen.findByText(/브라우저 메뉴의 '홈 화면에 추가'/)).toBeInTheDocument();
      expect(localStorage.getItem(KEY_INSTALLED)).toBeNull();
    } finally {
      restore();
    }
  });

  it("iOS 변형: 공유 → 홈 화면에 추가 안내, 지금 추가 버튼 없음", async () => {
    markInstallEligible();
    const restore = stubNavigator({ userAgent: IPHONE_UA, maxTouchPoints: 5 });
    try {
      render(<InstallCard />);
      expect(await screen.findByText(/공유 버튼.*'홈 화면에 추가'/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "지금 추가" })).toBeNull();
      expect(screen.getByRole("button", { name: "나중에" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("나중에 → 30일 숨김 후 사라지고, 기한이 지나면 다시 보인다", async () => {
    markInstallEligible();
    const restore = stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    try {
      render(<InstallCard />);
      const before = Date.now();
      fireEvent.click(await screen.findByRole("button", { name: "나중에" }));
      await waitFor(() => expect(screen.queryByRole("heading", { name: INSTALL_CARD_TITLE })).toBeNull());
      const hiddenUntil = Date.parse(localStorage.getItem(KEY_HIDDEN_UNTIL) ?? "");
      expect(hiddenUntil - before).toBeGreaterThanOrEqual(30 * DAY);
      expect(hiddenUntil - before).toBeLessThan(30 * DAY + 5_000);

      dismissInstallCard(-1); // 어제까지 숨김 = 기한 만료
      expect(await screen.findByRole("heading", { name: INSTALL_CARD_TITLE })).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

describe("완료 출처 (use-missions → 설치 자격)", () => {
  it("소급 동기화(sync)로 201 이 나도 자격을 주지 않는다", async () => {
    loggedIn();
    writePending("read", TODAY);
    vi.mocked(missionsAPI.complete).mockResolvedValueOnce({ mission_date: TODAY, kind: "read", completed_at: "x" });
    render(wrap(<ReadCompleteButton askHref="/hoondok/ask" />));
    await waitFor(() => expect(missionsAPI.complete).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    await waitFor(() => expect(localStorage.getItem("hoondok:pending:read")).toBeNull());
    expect(localStorage.getItem(KEY_ELIGIBLE)).toBeNull();
  });

  it("직접 완료(user) 201 → 자격", async () => {
    loggedIn();
    vi.mocked(missionsAPI.complete).mockResolvedValueOnce({ mission_date: TODAY, kind: "read", completed_at: "x" });
    render(wrap(<ReadCompleteButton askHref="/hoondok/ask" />));
    const button = await screen.findByRole("button", { name: /훈독 완료/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    await waitFor(() => expect(localStorage.getItem(KEY_ELIGIBLE)).toBe("1"));
  });

  it("직접 완료가 409(already)면 recorded 가 아니라 자격을 주지 않는다", async () => {
    loggedIn();
    vi.mocked(missionsAPI.complete).mockRejectedValueOnce(new ApiError(409, { message: "오늘은 이미 완료했어요" }));
    render(wrap(<ReadCompleteButton askHref="/hoondok/ask" />));
    const button = await screen.findByRole("button", { name: /훈독 완료/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    expect(localStorage.getItem(KEY_ELIGIBLE)).toBeNull();
  });
});
