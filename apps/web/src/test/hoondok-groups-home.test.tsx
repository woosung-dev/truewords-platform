import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 함께 읽는 모임 W2 홈·완료 뒤 (PLAN-HD-010 §6·§9 Vitest W2): 홈 모임 있음/없음, 비로그인·401 진입 returnTo,
// "N일차", 완료 뒤 한 줄 진입(서버 확정만), 플래그 OFF 면 모임 요소 0, 훈독 완료 → 홈 카드 숫자 갱신.
// 모임 API 는 fetch 만 바꿔 실제 경로로 검증한다. 사용자·미션 API 는 모듈 mock.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/hoondok/read",
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
vi.mock("@/features/hoondok/missions-api", () => ({
  missionsAPI: { complete: vi.fn(), summary: vi.fn() },
}));

import { ReadCompleteButton } from "@/features/hoondok/components/read-complete-button";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { GroupCard, jeongseongLine } from "@/features/hoondok/together/components/group-card";
import { GroupList } from "@/features/hoondok/together/components/group-list";
import { GroupShareEntry } from "@/features/hoondok/together/components/together-card";
import type { MyGroupItem } from "@/features/hoondok/together/groups-api";
import { useCompleteMission } from "@/features/hoondok/use-missions";
import { identityAPI } from "@/features/identity/api";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const EMPTY_SUMMARY = {
  today: { read: false, pray: false, study: false },
  streak_days: 0,
  best_streak_days: 0,
  total_days: 0,
  week: [],
};

function group(overrides: Partial<MyGroupItem> = {}): MyGroupItem {
  return {
    id: "g-1",
    name: "은혜 훈독모임",
    kind: "small_group",
    role: "member",
    my_display_name: "효진",
    today_read_count: 5,
    readers_preview: ["은", "미", "효"],
    jeongseongs: [],
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
let myGroups: () => Response = () => json([]);
function groupsCalls() {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes("/hoondok/me/groups")).length;
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrap(children: ReactNode, client = makeClient()) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function loggedIn() {
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
  vi.mocked(missionsAPI.summary).mockResolvedValue(EMPTY_SUMMARY);
}
function loggedOut() {
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "x" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  myGroups = () => json([]);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/hoondok/me/groups")) return myGroups();
    if (url.includes("/hoondok/today/together"))
      return json({ date: "2026-09-23", count: null, is_shown: false, threshold: 10 });
    return json({ detail: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_TOGETHER", "1");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GroupList (홈 모임 카드)", () => {
  it("모임이 있으면 '{이름} · 오늘 N명이 함께 읽었어요' + 이니셜 + N일차, 상세로 간다", async () => {
    loggedIn();
    myGroups = () =>
      json([
        group({
          jeongseongs: [
            {
              id: "j1",
              title: "특별정성",
              duration_days: 40,
              started_on: "2026-09-12",
              day_index: 12,
              state: "active",
              is_official: true,
              source_note: null,
            },
            {
              id: "j2",
              title: "다음 정성",
              duration_days: 21,
              started_on: "2026-10-01",
              day_index: null,
              state: "upcoming",
              is_official: false,
              source_note: null,
            },
          ],
        }),
      ]);
    render(wrap(<GroupList />));
    const card = await screen.findByRole("link", { name: /은혜 훈독모임/ });
    expect(card).toHaveAttribute("href", "/hoondok/groups/g-1");
    expect(card).toHaveTextContent("은혜 훈독모임 · 오늘 5명이 함께 읽었어요");
    expect(card).toHaveTextContent("특별정성 12일차");
    expect(card).not.toHaveTextContent("다음 정성");
    expect(within(card).getByText("은")).toHaveClass("tg-av");
    expect(screen.queryByText(/새벽|아직/)).toBeNull();
  });

  it("오늘 완료자가 0명이면 숫자 없이 이름 + '오늘의 말씀을 함께 읽어요'", async () => {
    loggedIn();
    myGroups = () => json([group({ today_read_count: 0, readers_preview: [] })]);
    render(wrap(<GroupList />));
    const card = await screen.findByRole("link", { name: /은혜 훈독모임/ });
    expect(card).toHaveTextContent("오늘의 말씀을 함께 읽어요");
    expect(card).not.toHaveTextContent(/\d+명/);
    expect(card.querySelector(".avatars")).toBeNull();
  });

  it("최대 5개만 싣는다", async () => {
    loggedIn();
    myGroups = () => json(Array.from({ length: 7 }, (_, i) => group({ id: `g-${i}`, name: `모임${i}` })));
    render(wrap(<GroupList />));
    await screen.findByText("모임0");
    expect(
      screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/hoondok/groups/g-")),
    ).toHaveLength(5);
    expect(screen.queryByText("모임5")).toBeNull();
  });

  it("긴 이름·이모지는 한 줄 말줄임 클래스로 감싼다(390px 가로 넘침 방지)", async () => {
    loggedIn();
    const long = "🌅🙏 아주아주 길고 긴 우리 동네 새로운 말씀 훈독 모임 이름입니다 🌿🌿🌿";
    myGroups = () => json([group({ name: long })]);
    render(wrap(<GroupList />));
    const name = await screen.findByText(long);
    expect(name).toHaveClass("tg-gc__nm");
    expect(name.closest("a")).toHaveClass("tg-gc");
  });

  it("로그인 + 모임 없음: 진입 카드가 만들기·참여로 바로 간다", async () => {
    loggedIn();
    render(wrap(<GroupList />));
    expect(await screen.findByRole("link", { name: "모임 만들기" })).toHaveAttribute("href", "/hoondok/groups/new");
    expect(screen.getByRole("link", { name: "초대 코드로 참여" })).toHaveAttribute("href", "/hoondok/groups/join");
    expect(screen.getByText("가족 모임은 곧 열려요")).toBeInTheDocument();
  });

  it("비로그인: 진입 카드가 온보딩(returnTo) 을 거치고 /me/groups 를 부르지 않는다", async () => {
    loggedOut();
    render(wrap(<GroupList />));
    expect(await screen.findByRole("link", { name: "모임 만들기" })).toHaveAttribute(
      "href",
      "/hoondok/onboarding?returnTo=%2Fhoondok%2Fgroups%2Fnew",
    );
    expect(screen.getByRole("link", { name: "초대 코드로 참여" })).toHaveAttribute(
      "href",
      "/hoondok/onboarding?returnTo=%2Fhoondok%2Fgroups%2Fjoin",
    );
    expect(groupsCalls()).toBe(0);
  });

  it("/me/groups 401(세션 만료) 이면 비로그인 진입 카드, 오류 안내 없음", async () => {
    loggedIn();
    myGroups = () => json({ detail: "unauthorized" }, 401);
    render(wrap(<GroupList />));
    expect(await screen.findByRole("link", { name: "모임 만들기" })).toHaveAttribute(
      "href",
      "/hoondok/onboarding?returnTo=%2Fhoondok%2Fgroups%2Fnew",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("그 외 오류면 섹션째 숨긴다", async () => {
    loggedIn();
    myGroups = () => json({ detail: "boom" }, 500);
    render(wrap(<GroupList />));
    await waitFor(() => expect(groupsCalls()).toBe(2), { timeout: 4000 }); // 훅의 retry 1회(1초)
    await waitFor(() => expect(screen.queryByTestId("group-list")).toBeNull());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("플래그 OFF 면 모임 요소가 하나도 없다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_TOGETHER", "");
    loggedIn();
    myGroups = () => json([group()]);
    const { container } = render(wrap(<GroupList />));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
    expect(groupsCalls()).toBe(0);
  });

  it("훈독 완료(PROGRESS_KEYS) 뒤 새로고침 없이 카드 숫자가 바뀐다", async () => {
    loggedIn();
    let count = 2;
    myGroups = () => json([group({ today_read_count: count })]);
    vi.mocked(missionsAPI.complete).mockResolvedValueOnce(undefined as never);
    function Complete() {
      const mutation = useCompleteMission("read");
      return (
        <button type="button" onClick={() => mutation.mutate("user")}>
          완료
        </button>
      );
    }
    render(
      wrap(
        <>
          <GroupList />
          <Complete />
        </>,
      ),
    );
    expect(await screen.findByText(/오늘 2명이 함께 읽었어요/)).toBeInTheDocument();
    count = 3;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "완료" }));
    });
    expect(await screen.findByText(/오늘 3명이 함께 읽었어요/)).toBeInTheDocument();
    expect(groupsCalls()).toBe(2);
  });
});

describe("GroupCard · jeongseongLine", () => {
  it("진행 중 정성만 ' · ' 로 잇는다", () => {
    const js = (title: string, day: number | null, state: "active" | "upcoming") => ({
      id: title,
      title,
      duration_days: 40,
      started_on: "2026-09-01",
      day_index: day,
      state,
      is_official: false,
      source_note: null,
    });
    expect(jeongseongLine({ jeongseongs: [js("특별정성", 12, "active"), js("모임 정성", 9, "active")] })).toBe(
      "특별정성 12일차 · 모임 정성 9일차",
    );
    expect(jeongseongLine({ jeongseongs: [js("곧", null, "upcoming")] })).toBe("");
  });

  it("이니셜은 3개까지", () => {
    render(wrap(<GroupCard group={group({ readers_preview: ["가", "나", "다", "라"] })} />));
    expect(screen.getByRole("link").querySelectorAll(".tg-av")).toHaveLength(3);
  });
});

describe("훈독하기 완료 뒤 한 줄 남기기 진입", () => {
  it("서버 확정 완료 + 모임 있음: '{첫 모임}에 나눔 한 줄 남기기 · 식구에게 보여요' → 한 줄 쓰기", async () => {
    loggedIn();
    myGroups = () => json([group({ id: "g-a", name: "첫 모임" }), group({ id: "g-b", name: "둘째" })]);
    vi.mocked(missionsAPI.complete).mockResolvedValueOnce(undefined as never);
    render(wrap(<ReadCompleteButton askHref="/hoondok/ask" />));
    const button = await screen.findByRole("button", { name: /훈독 완료/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    // 개인 "오늘의 한 줄"(나만 봄)과 헷갈리지 않게 공개 나눔임을 이름에 담는다 (QA P2-12)
    const link = await screen.findByRole("link", { name: /첫 모임에 나눔 한 줄 남기기/ });
    expect(link).toHaveTextContent("식구에게 보여요");
    expect(link).toHaveAttribute("href", "/hoondok/groups/g-a/share");
    expect(screen.queryByText(/둘째/)).toBeNull();
  });

  it("저장 실패(오프라인) 면 보이지 않는다", async () => {
    loggedIn();
    myGroups = () => json([group()]);
    vi.mocked(missionsAPI.complete).mockRejectedValueOnce(new TypeError("fetch failed"));
    render(wrap(<ReadCompleteButton askHref="/hoondok/ask" />));
    const button = await screen.findByRole("button", { name: /훈독 완료/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByText(/아직 저장하지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByText(/한 줄 남기기/)).toBeNull();
    expect(groupsCalls()).toBe(0);
  });

  it("비로그인이면 보이지 않는다", async () => {
    loggedOut();
    render(wrap(<ReadCompleteButton askHref="/hoondok/ask" />));
    await screen.findByText("완료 기록은 로그인 후 남아요");
    fireEvent.click(screen.getByRole("button", { name: /훈독 완료/ }));
    expect(screen.getByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    expect(screen.queryByText(/한 줄 남기기/)).toBeNull();
    expect(groupsCalls()).toBe(0);
  });

  it("모임이 없으면·플래그 OFF 면 그리지 않는다", async () => {
    loggedIn();
    const { container, unmount } = render(wrap(<GroupShareEntry isCounted />));
    await waitFor(() => expect(groupsCalls()).toBe(1));
    expect(container).toBeEmptyDOMElement();
    unmount();
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_TOGETHER", "");
    myGroups = () => json([group()]);
    const off = render(wrap(<GroupShareEntry isCounted />));
    await new Promise((r) => setTimeout(r, 0));
    expect(off.container).toBeEmptyDOMElement();
    expect(groupsCalls()).toBe(1);
  });
});
