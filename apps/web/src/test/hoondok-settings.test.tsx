import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, prefetch: vi.fn() }),
  usePathname: () => "/hoondok/settings",
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

import { INSTALL_CARD_TITLE } from "@/features/hoondok/install/components/install-card";
import { SettingsScreen } from "@/features/hoondok/settings/components/settings-screen";
import { identityAPI } from "@/features/identity/api";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
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
}

/** 1단계 행 → 확인 카드까지 연 상태로 만든다. */
async function openConfirm() {
  render(wrap(<SettingsScreen />));
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
    render(wrap(<SettingsScreen />));
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
    render(wrap(<SettingsScreen />));
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
    const quiet = screen.getByText("조용한 시간").closest(".st-row");
    expect(quiet).toHaveTextContent("준비 중");
    expect(quiet?.querySelector("a, button")).toBeNull();
    // 알림함은 싣지 않는다 (PLAN-HD-002 W1-S)
    expect(screen.queryByText("알림함")).toBeNull();
  });
});

describe("SCR-PWA-015 내 데이터 삭제 (API-HD-011)", () => {
  it("비로그인은 삭제 행 대신 로그인 안내를 보여준다", async () => {
    render(wrap(<SettingsScreen />));

    expect(await screen.findByText("로그인하면 내 데이터를 관리할 수 있어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /로그인/ })).toHaveAttribute(
      "href",
      "/hoondok/onboarding?returnTo=%2Fhoondok%2Fsettings",
    );
    expect(screen.queryByRole("button", { name: /내 데이터 삭제/ })).toBeNull();
    expect(identityAPI.deleteMe).not.toHaveBeenCalled();
  });

  it("로그인 → 1단계 행만으로는 호출하지 않고, 2단계 '지우기' 에서 삭제 후 홈으로 보낸다", async () => {
    loggedIn();
    vi.mocked(identityAPI.deleteMe).mockResolvedValue(undefined);

    const confirm = await openConfirm();
    expect(confirm).toHaveTextContent("정말 지울까요?");
    expect(confirm).toHaveTextContent("되돌릴 수 없어요");
    // 모임 영향도 알린다 (QA P2-R2-2)
    expect(confirm).toHaveTextContent("함께 읽는 모임에서도 빠지고 내가 남긴 한 줄은 지워져요");
    expect(confirm).toHaveTextContent("내가 리더인 모임은 가장 먼저 들어온 식구가 이어받아요");
    // 확인 카드를 열기만 해서는 아무것도 지우지 않는다
    expect(identityAPI.deleteMe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(identityAPI.deleteMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/hoondok"));
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
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/hoondok/onboarding?returnTo=%2Fhoondok%2Fsettings"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SCR-PWA-015 설치 안내 (상시 노출)", () => {
  it("자격·30일 숨김과 무관하게 일반 안내를 렌더하고 '나중에' 는 두지 않는다", async () => {
    // 홈 조건(자격 없음 + 숨김 기한 안)에서도 설정에서는 보인다
    localStorage.setItem("hoondok:install:hidden-until", new Date(Date.now() + 86_400_000).toISOString());
    render(wrap(<SettingsScreen />));

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
    render(wrap(<SettingsScreen />));

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
    render(wrap(<SettingsScreen />));

    expect(await screen.findByText("기본 브라우저에서 열면 홈 화면에 추가할 수 있어요")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: INSTALL_CARD_TITLE })).toBeNull();
    expect(screen.queryByText(/공유 버튼/)).toBeNull();
    expect(screen.queryByText("이미 홈 화면에서 열었어요")).toBeNull();
  });
});
