import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, prefetch: vi.fn() }),
  usePathname: () => "/settings",
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn(), deleteMe: vi.fn() },
}));
// 이 파일은 알림이 "준비 중" 인 화면만 본다 — 서버 설정 없음을 고정한다.
// 켤 수 있을 때의 흐름은 hoondok-push-settings.test.tsx 가 갖는다 (PLAN-HD-006).
vi.mock("@/features/hoondok/notifications/api", () => ({
  notificationsAPI: {
    config: vi.fn(async () => ({ enabled: false, public_key: null })),
    prefs: vi.fn(),
    savePrefs: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("@/features/hoondok/missions-api", () => ({
  missionsAPI: { complete: vi.fn(), summary: vi.fn() },
}));

import { INSTALL_CARD_TITLE } from "@/features/hoondok/install/components/install-card";
import { SettingsScreen } from "@/features/hoondok/settings/components/settings-screen";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { identityAPI } from "@/features/identity/api";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const SUMMARY = {
  today: { read: true, pray: false, study: false },
  streak_days: 3,
  best_streak_days: 12,
  total_days: 47,
  week: [],
};
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** jsdom 의 navigator 속성은 프로토타입 getter 라 own property 로 덮고 끝나면 지운다 (hoondok-install.test 방식). */
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

function loggedOut() {
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "로그인이 필요합니다" }));
}
function loggedIn() {
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
  vi.mocked(missionsAPI.summary).mockResolvedValue(SUMMARY);
}

/** 1단계 행 → 확인 카드까지 연 상태로 만든다. */
async function openConfirm() {
  render(wrap(<SettingsScreen todayWeekday={1} />));
  fireEvent.click(await screen.findByRole("button", { name: /내 데이터 삭제/ }));
  return screen.findByRole("group", { name: "내 데이터 삭제 확인" });
}

let restoreNavigator = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  restoreNavigator = stubNavigator({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
  loggedOut();
});
afterEach(() => {
  restoreNavigator();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SCR-PWA-015 알림 (서버 설정 없음 = 준비 중)", () => {
  it("훈독하기 토글은 disabled + '준비 중' 이고, 시간 선택도 누를 수 없다", async () => {
    render(wrap(<SettingsScreen todayWeekday={1} />));
    // 훈독하기 · 그 밖의 알림 · 조용한 시간 — 훈독하기 행은 서버 설정을 받은 뒤에 "준비 중" 으로 확정된다
    await waitFor(() => expect(screen.getAllByText("준비 중")).toHaveLength(3));

    const toggle = screen.getByRole("button", { name: "훈독하기 알림" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    // 눌러도 상태가 바뀌지 않는다 (네이티브 disabled — 핸들러 자체가 없다)
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    // 켤 수 없으면 추천 칸 대신 꺼진 시간 행 하나다
    expect(screen.getByText("오전 6:00").closest("button")).toBeDisabled();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await waitFor(() => expect(identityAPI.me).toHaveBeenCalled());
  });

  it("기도하기·가정예배·공지는 '그 밖의 알림' 한 줄로 접고, 조용한 시간은 '준비 중' · 알림함은 없다", async () => {
    render(wrap(<SettingsScreen todayWeekday={1} />));
    await waitFor(() => expect(identityAPI.me).toHaveBeenCalled());

    expect(screen.getByText("그 밖의 알림")).toBeInTheDocument();
    expect(screen.getByText("기도하기 · 가정예배 · 공지")).toBeInTheDocument();
    for (const label of ["기도하기 알림", "가정예배 알림", "공지 알림"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    // 종류 수를 세지 않는다 · '아침' 에 묶지 않는다
    expect(screen.queryByText("4종")).toBeNull();
    expect(screen.queryByText(/아침 훈독/)).toBeNull();
    // 공지 설명(소속 교회)을 받지 않는다 (DEC-PWA-023)
    expect(screen.queryByText(/교회/)).toBeNull();

    // 조용한 시간은 누를 수 있는 줄(링크·버튼)이 아니라 '준비 중' 표시다
    const quiet = screen.getByText("조용한 시간").closest(".ra-row");
    expect(quiet).toHaveTextContent("준비 중");
    expect(quiet?.querySelector("a, button")).toBeNull();
    // 알림함은 싣지 않는다 (PLAN-HD-002 W1-S)
    expect(screen.queryByText("알림함")).toBeNull();
  });
});

describe("SCR-PWA-015 내 데이터 삭제 (API-HD-011)", () => {
  it("비로그인은 삭제 행 대신 로그인 안내를 보여준다", async () => {
    render(wrap(<SettingsScreen todayWeekday={1} />));

    expect(await screen.findByText("로그인하면 내 데이터를 관리할 수 있어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /로그인/ })).toHaveAttribute("href", "/onboarding?returnTo=%2Fsettings");
    expect(screen.queryByRole("button", { name: /내 데이터 삭제/ })).toBeNull();
    expect(identityAPI.deleteMe).not.toHaveBeenCalled();
  });

  it("로그인 → 1단계 행만으로는 호출하지 않고, 2단계 '지우기' 에서 삭제 후 홈으로 보낸다", async () => {
    loggedIn();
    vi.mocked(identityAPI.deleteMe).mockResolvedValue(undefined);

    const confirm = await openConfirm();
    expect(confirm).toHaveTextContent("정말 지울까요?");
    expect(confirm).toHaveTextContent("되돌릴 수 없어요");
    expect(confirm).not.toHaveTextContent("모임");
    // 확인 카드를 열기만 해서는 아무것도 지우지 않는다
    expect(identityAPI.deleteMe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(identityAPI.deleteMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("'취소' 는 1단계로 되돌리고, 실패는 인라인 오류로 남는다 (401 은 온보딩으로)", async () => {
    loggedIn();
    await openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    // React 가 같은 위치의 div 를 재사용하므로 노드 동일성이 아니라 role 질의로 사라짐을 본다
    await waitFor(() => expect(screen.queryByRole("group", { name: "내 데이터 삭제 확인" })).toBeNull());
    expect(identityAPI.deleteMe).not.toHaveBeenCalled();

    vi.mocked(identityAPI.deleteMe).mockRejectedValueOnce(new ApiError(503, { message: "down" }));
    fireEvent.click(screen.getByRole("button", { name: /내 데이터 삭제/ }));
    fireEvent.click(await screen.findByRole("button", { name: "지우기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("지우지 못했어요. 잠시 뒤 다시 시도해 주세요");
    expect(mockReplace).not.toHaveBeenCalled();

    // 401 = 쿠키가 이미 만료됐다 — 오류 문구 대신 온보딩으로 보낸다
    vi.mocked(identityAPI.deleteMe).mockRejectedValueOnce(new ApiError(401, { message: "로그인이 필요합니다" }));
    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/onboarding?returnTo=%2Fsettings"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SCR-PWA-015 안내", () => {
  it("로그인 여부와 무관하게 개인정보 처리방침으로 가는 행이 있다", async () => {
    render(wrap(<SettingsScreen todayWeekday={1} />));
    expect(await screen.findByRole("link", { name: /개인정보 처리방침/ })).toHaveAttribute("href", "/privacy");
  });
});

describe("SCR-PWA-015 설치 안내 (상시 노출)", () => {
  it("자격·30일 숨김과 무관하게 일반 안내를 렌더하고 '나중에' 는 두지 않는다", async () => {
    // 홈 조건(자격 없음 + 숨김 기한 안)에서도 설정에서는 보인다
    localStorage.setItem("hoondok:install:hidden-until", new Date(Date.now() + 86_400_000).toISOString());
    render(wrap(<SettingsScreen todayWeekday={1} />));

    expect(await screen.findByRole("heading", { name: INSTALL_CARD_TITLE })).toBeInTheDocument();
    expect(screen.getByText(/브라우저 메뉴의 '홈 화면에 추가'/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "나중에" })).toBeNull();
    expect(screen.queryByText("이미 홈 화면에서 열었어요")).toBeNull();
  });

  it("standalone 이면 카드 대신 한 줄 안내", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    render(wrap(<SettingsScreen todayWeekday={1} />));

    expect(await screen.findByText("이미 홈 화면에서 열었어요")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: INSTALL_CARD_TITLE })).toBeNull();
  });

  it("iPhone 카카오톡 인앱이면 설치 단계(공유 버튼) 대신 기본 브라우저 안내 한 줄 — standalone 문구보다 먼저", async () => {
    restoreNavigator();
    restoreNavigator = stubNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5",
      maxTouchPoints: 5,
    });
    // standalone 으로 보이는 환경이어도 인앱 분기가 먼저다
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    render(wrap(<SettingsScreen todayWeekday={1} />));

    expect(await screen.findByText("기본 브라우저에서 열면 홈 화면에 추가할 수 있어요")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: INSTALL_CARD_TITLE })).toBeNull();
    expect(screen.queryByText(/공유 버튼/)).toBeNull();
    expect(screen.queryByText("이미 홈 화면에서 열었어요")).toBeNull();
  });
});

describe("관리 화면 맨 위 카드·계정 로그아웃", () => {
  it("로그인하면 누적·현재 연속·최대 연속을 보이고 오늘 훈독·나의 정원으로 가는 길을 둔다", async () => {
    loggedIn();
    render(wrap(<SettingsScreen todayWeekday={1} />));
    expect(await screen.findByText("현재 연속")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "오늘 훈독하기" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /나의 정원/ })).toHaveAttribute("href", "/garden");
  });

  it("로그인 전에는 기록 요약을 부르지 않고 시작하기(→ 온보딩, 돌아올 곳 /settings)를 둔다", async () => {
    render(wrap(<SettingsScreen todayWeekday={1} />));
    expect(await screen.findByRole("heading", { name: "로그인하면 훈독 기록이 이어져요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "시작하기" })).toHaveAttribute("href", "/onboarding?returnTo=%2Fsettings");
    expect(missionsAPI.summary).not.toHaveBeenCalled();
  });

  async function logoutConfirm() {
    loggedIn();
    render(wrap(<SettingsScreen todayWeekday={1} />));
    expect(await screen.findByText("a@b.c")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    return screen.getByRole("group", { name: "로그아웃 확인" });
  }

  it("이메일과 로그아웃 행을 보이고, 누르면 확인 카드가 뜬다 — 기기 기록 지우기가 기본으로 켜져 있다", async () => {
    await logoutConfirm();

    expect(screen.getByRole("checkbox", { name: /이 기기에 남은 기록도 지우기/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    expect(identityAPI.logout).not.toHaveBeenCalled();
  });

  it("로그아웃하면 같은 화면에 머물러 '로그아웃했어요' 를 알리고 기기 기록을 지운다", async () => {
    localStorage.setItem("hoondok:ask:items", "[]");
    localStorage.setItem("hoondok:device-owner", "u1");
    vi.mocked(identityAPI.logout).mockResolvedValue({});
    await logoutConfirm();

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    const title = await screen.findByRole("heading", { name: "로그아웃했어요" });
    expect(title).toHaveFocus();
    expect(identityAPI.logout).toHaveBeenCalledOnce();
    expect(screen.queryByText("a@b.c")).not.toBeInTheDocument();
    expect(localStorage.getItem("hoondok:ask:items")).toBeNull();
    expect(localStorage.getItem("hoondok:device-owner")).toBeNull();
  });

  it("지우기를 끄면 기기 기록과 주인 표시를 남긴다 — 다른 계정이 로그인할 때 claimDeviceForUser 가 지운다", async () => {
    localStorage.setItem("hoondok:ask:items", "[]");
    localStorage.setItem("hoondok:device-owner", "u1");
    vi.mocked(identityAPI.logout).mockResolvedValue({});
    await logoutConfirm();

    fireEvent.click(screen.getByRole("checkbox", { name: /이 기기에 남은 기록도 지우기/ }));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    await screen.findByRole("heading", { name: "로그아웃했어요" });
    expect(localStorage.getItem("hoondok:ask:items")).toBe("[]");
    expect(localStorage.getItem("hoondok:device-owner")).toBe("u1");
  });

  it("로그아웃이 실패하면 확인 카드에 오류를 보이고 로그인 상태와 기기 기록을 그대로 둔다", async () => {
    localStorage.setItem("hoondok:ask:items", "[]");
    vi.mocked(identityAPI.logout).mockRejectedValue(new Error("offline"));
    await logoutConfirm();

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("로그아웃하지 못했어요");
    expect(screen.queryByRole("heading", { name: "로그아웃했어요" })).toBeNull();
    expect(screen.getAllByText("효진").length).toBeGreaterThan(0);
    expect(localStorage.getItem("hoondok:ask:items")).toBe("[]");
  });

  it("취소하면 확인 카드를 닫고 로그아웃하지 않는다", async () => {
    await logoutConfirm();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("group", { name: "로그아웃 확인" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(identityAPI.logout).not.toHaveBeenCalled();
  });
});
