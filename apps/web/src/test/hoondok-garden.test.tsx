import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/hoondok/garden",
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
vi.mock("@/features/hoondok/missions-api", () => ({
  missionsAPI: { complete: vi.fn(), summary: vi.fn() },
}));
vi.mock("@/features/hoondok/history-api", () => ({ historyAPI: { month: vi.fn() } }));
// 정원 '나의 기록' 섹션(C1)의 표시 목록 — 이 파일은 통계·달력·정성만 보므로 빈 목록으로 둔다(실제 fetch 0)
vi.mock("@/features/hoondok/library/api", async (original) => ({
  ...(await original<object>()),
  libraryAPI: { marks: vi.fn().mockResolvedValue({ items: [] }) },
}));
vi.mock("@/features/hoondok/jeongseong-api", () => ({
  jeongseongAPI: { current: vi.fn(), create: vi.fn(), abandon: vi.fn() },
}));

import { MonthCalendar } from "@/components/hoondok";
import { GardenScreen } from "@/features/hoondok/garden/components/garden-screen";
import { historyAPI } from "@/features/hoondok/history-api";
import type { JeongseongPeriodResponse } from "@/features/hoondok/jeongseong-api";
import { jeongseongAPI } from "@/features/hoondok/jeongseong-api";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { identityAPI } from "@/features/identity/api";

const MONTH = "2026-09";
const TODAY = "2026-09-10";
const USER = { id: "u1", email: "a@b.c", display_name: "효진" };

/** 2026-09: 30일, 1일이 화요일. 1·2·10 일 완료(10 일 = 오늘) */
const DONE_DATES = new Set(["2026-09-01", "2026-09-02", "2026-09-10"]);
const DAYS = Array.from({ length: 30 }, (_, index) => {
  const date = `2026-09-${String(index + 1).padStart(2, "0")}`;
  return { date, done: DONE_DATES.has(date) };
});

const SUMMARY = {
  today: { read: true, pray: false, study: false },
  streak_days: 3,
  best_streak_days: 12,
  total_days: 47,
  week: [],
};

const PERIOD: JeongseongPeriodResponse = {
  id: "p1",
  topic: "가정의 화목",
  resolution: null,
  duration_days: 21,
  started_on: "2026-09-04",
  reminder_time: null,
  status: "active",
  // 7일차(21 - 14)에 읽은 날은 5일 — 일차와 읽은 날을 일부러 다르게 둬 화면이 done 기준 값을 쓰면 잡히게 한다
  progress: { end_on: "2026-09-24", done_days: 5, missed_days: 1, remaining_days: 14, percent: 24, state: "active" },
};

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function loggedOut() {
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "x" }));
}

function loggedIn(period: JeongseongPeriodResponse | null = PERIOD) {
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
  vi.mocked(missionsAPI.summary).mockResolvedValue(SUMMARY);
  vi.mocked(historyAPI.month).mockResolvedValue({ month: MONTH, days: DAYS });
  vi.mocked(jeongseongAPI.current).mockResolvedValue({ period });
}

function renderGarden() {
  return render(wrap(<GardenScreen month={MONTH} today={TODAY} />));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("MonthCalendar (DES §2.6)", () => {
  it("2026년 9월: 앞 빈 칸 1(1일 화요일) · 날짜 칸 30 · 전체 문장 레이블", () => {
    const { container } = render(<MonthCalendar month={MONTH} days={DAYS} today={TODAY} />);

    expect(screen.getByRole("heading", { name: "2026년 9월" })).toBeInTheDocument();
    expect(container.querySelectorAll(".gd-cal__pad")).toHaveLength(1);
    expect(container.querySelectorAll(".gd-cal__day")).toHaveLength(30);
    expect(screen.getByLabelText("9월 1일 완료")).toBeInTheDocument();
    // 완료하지 않은 지난날은 날짜만 읽는다 — "아직" 이 없다 (DEC-PWA-023)
    expect(screen.getByLabelText("9월 3일")).toBeInTheDocument();
    expect(screen.getByLabelText("9월 10일 오늘 완료")).toBeInTheDocument();
    expect(container.querySelector('[aria-label*="아직"]')).toBeNull();
    // 범례는 완료 1개 — "아직" 은 없고 "쉼" 은 데이터가 없어 그리지 않는다
    const legend = container.querySelectorAll(".gd-cal__legend > span");
    expect(legend).toHaveLength(1);
    expect(legend[0]).toHaveTextContent("완료");
    expect(container.querySelector(".gd-cal__legend")).not.toHaveTextContent("아직");
  });

  it("완료하지 않은 칸에는 원이 없고 날짜만 있다 — 원은 완료 칸에만 그린다", () => {
    const { container } = render(<MonthCalendar month={MONTH} days={DAYS} today={TODAY} />);

    expect(container.querySelectorAll(".gd-cal__day:not([data-done]) .gd-cal__dot")).toHaveLength(0);
    expect(container.querySelectorAll(".gd-cal__day[data-done] .gd-cal__dot--done svg")).toHaveLength(3);
    const missed = screen.getByLabelText("9월 3일");
    expect(missed).toHaveTextContent(/^3$/);
  });

  it("오늘 칸은 data-today, 완료 칸은 data-done, 미래 칸은 data-future 를 갖는다", () => {
    const { container } = render(<MonthCalendar month={MONTH} days={DAYS} today={TODAY} />);

    expect(container.querySelectorAll(".gd-cal__day[data-done]")).toHaveLength(3);
    const todayCells = container.querySelectorAll(".gd-cal__day[data-today]");
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0]).toHaveAttribute("data-done");
    expect(todayCells[0]).toHaveAttribute("aria-label", "9월 10일 오늘 완료");
    // 11 ~ 30 일은 아직 오지 않은 날
    expect(container.querySelectorAll(".gd-cal__day[data-future]")).toHaveLength(20);
  });

  it("오늘 아직 완료 전이면 레이블이 '9월 11일 오늘' 이고 원이 없다", () => {
    render(<MonthCalendar month={MONTH} days={DAYS} today="2026-09-11" />);
    const todayCell = screen.getByLabelText("9월 11일 오늘");
    expect(todayCell).toHaveAttribute("data-today");
    expect(todayCell.querySelector(".gd-cal__dot")).toBeNull();
  });
});

describe("GardenScreen 비로그인", () => {
  it("안내 카드 + 온보딩 링크(returnTo=/hoondok/garden)만 보이고 기록 API 를 부르지 않는다", async () => {
    loggedOut();
    renderGarden();

    expect(
      await screen.findByRole("heading", { name: "로그인하면 훈독 기록과 정성을 볼 수 있어요" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "시작하기" })).toHaveAttribute(
      "href",
      "/hoondok/onboarding?returnTo=%2Fhoondok%2Fgarden",
    );
    expect(missionsAPI.summary).not.toHaveBeenCalled();
    expect(historyAPI.month).not.toHaveBeenCalled();
    expect(jeongseongAPI.current).not.toHaveBeenCalled();
  });
});

describe("GardenScreen 로그인", () => {
  it("프로필 이니셜 · 통계 3값 · 이번 달 완료 칸 수를 그린다", async () => {
    loggedIn();
    const { container } = renderGarden();

    expect(await screen.findByText("현재 연속일")).toBeInTheDocument();
    expect(screen.getByText("효진")).toBeInTheDocument();
    expect(container.querySelector(".gd-profile__av")).toHaveTextContent("효");

    const stats = container.querySelectorAll(".stats__n");
    expect(Array.from(stats, (node) => node.textContent)).toEqual(["3", "12", "47"]);
    expect(screen.getByText("현재 연속일")).toBeInTheDocument();

    expect(historyAPI.month).toHaveBeenCalledWith(MONTH);
    expect(container.querySelectorAll(".gd-cal__day[data-done]")).toHaveLength(3);
    expect(container.querySelectorAll(".gd-cal__day[data-today][data-done]")).toHaveLength(1);
  });

  it("불러오는 동안 실제 카드 높이의 자리 지킴을 둔다 — 글자 한 줄이 아니다", async () => {
    loggedIn();
    const { container } = renderGarden();

    const loading = screen.getByRole("status", { name: "기록을 불러오는 중" });
    expect(loading).toHaveAttribute("aria-busy", "true");
    // 통계 · 월 달력 · 정성 세 카드 자리 (DES §1.5 loading)
    expect(container.querySelectorAll(".skeleton")).toHaveLength(3);

    await screen.findByText("현재 연속일");
    expect(screen.queryByRole("status", { name: "기록을 불러오는 중" })).toBeNull();
  });

  it("진행 중인 정성이 없으면 '새로 시작' 링크가 홈 시트로 간다", async () => {
    loggedIn(null);
    renderGarden();

    expect(await screen.findByRole("heading", { name: "진행 중인 정성이 없어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새로 시작" })).toHaveAttribute("href", "/hoondok?sheet=jeongseong");
  });

  it("진행 중인 정성은 N일차 · 날짜 기준 막대 · 시작일 · 남은 날만 적는다 (읽은 날 수·퍼센트 없음)", async () => {
    loggedIn();
    const { container } = renderGarden();

    expect(await screen.findByText("21일 정성 · 가정의 화목")).toBeInTheDocument();
    expect(screen.getByText("7일차")).toBeInTheDocument();
    expect(screen.getByText("9월 4일에 시작했어요")).toBeInTheDocument();
    expect(screen.getByText("14일 남았어요")).toBeInTheDocument();
    // 막대는 일차 / 기간(7/21 = 33%). 읽은 날 기준 percent(24)를 쓰지 않는다
    const bar = screen.getByRole("progressbar", { name: "21일 정성 중 7일차" });
    expect(bar).toHaveAttribute("aria-valuenow", "7");
    expect(bar).toHaveAttribute("aria-valuemax", "21");
    expect(bar.firstElementChild).toHaveStyle({ width: "33%" });
    const card = container.querySelector(".gd-row")?.closest(".card")?.textContent ?? "";
    for (const banned of ["진행한 날", "/ 21일", "/21일", "%", "D-", "새벽", "밀린 날"])
      expect(card).not.toContain(banned);
  });

  it("시작 전 정성은 막대 없이 '시작 전 · M월 D일부터' 만 단다", async () => {
    loggedIn({
      ...PERIOD,
      started_on: "2026-09-13",
      progress: { ...PERIOD.progress, state: "upcoming", done_days: 0, percent: 0, remaining_days: 23 },
    });
    renderGarden();

    expect(await screen.findByText("시작 전 · 9월 13일부터")).toBeInTheDocument();
    expect(screen.getByText("21일 정성 · 가정의 화목")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/남았어요/)).toBeNull();
  });

  it("5xx 면 '기록을 불러오지 못했어요' + 다시 시도로 세 질의를 다시 읽는다", async () => {
    loggedIn();
    vi.mocked(missionsAPI.summary).mockRejectedValue(new ApiError(500, { message: "boom" }));
    const { container } = renderGarden();

    // useSummary 는 retry: 1 이라 첫 실패 뒤 한 번 더 시도한다 — 기본 1s 대기로는 짧다
    expect(
      await screen.findByRole("heading", { name: "기록을 불러오지 못했어요" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".gd-cal__day")).toHaveLength(0);

    vi.mocked(missionsAPI.summary).mockResolvedValue(SUMMARY);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByText("현재 연속일")).toBeInTheDocument());
  });
});

describe("GardenScreen 계정·로그아웃", () => {
  async function openConfirm() {
    loggedIn();
    renderGarden();
    expect(await screen.findByText("a@b.c")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    return screen.getByRole("group", { name: "로그아웃 확인" });
  }

  it("이메일과 로그아웃 행을 보이고, 누르면 확인 카드가 뜬다 — 기기 기록 지우기가 기본으로 켜져 있다", async () => {
    await openConfirm();

    expect(screen.getByRole("checkbox", { name: /이 기기에 남은 기록도 지우기/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    expect(identityAPI.logout).not.toHaveBeenCalled();
  });

  it("로그아웃하면 같은 화면에 머물러 '로그아웃했어요' 를 알리고 기기 기록을 지운다", async () => {
    localStorage.setItem("hoondok:ask:items", "[]");
    localStorage.setItem("hoondok:device-owner", "u1");
    vi.mocked(identityAPI.logout).mockResolvedValue({});
    await openConfirm();

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
    await openConfirm();

    fireEvent.click(screen.getByRole("checkbox", { name: /이 기기에 남은 기록도 지우기/ }));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    await screen.findByRole("heading", { name: "로그아웃했어요" });
    expect(localStorage.getItem("hoondok:ask:items")).toBe("[]");
    expect(localStorage.getItem("hoondok:device-owner")).toBe("u1");
  });

  it("로그아웃이 실패하면 확인 카드에 오류를 보이고 로그인 상태와 기기 기록을 그대로 둔다", async () => {
    localStorage.setItem("hoondok:ask:items", "[]");
    vi.mocked(identityAPI.logout).mockRejectedValue(new Error("offline"));
    await openConfirm();

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("로그아웃하지 못했어요");
    expect(screen.getByText("현재 연속일")).toBeInTheDocument();
    expect(localStorage.getItem("hoondok:ask:items")).toBe("[]");
  });

  it("취소하면 확인 카드를 닫고 로그아웃하지 않는다", async () => {
    await openConfirm();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("group", { name: "로그아웃 확인" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(identityAPI.logout).not.toHaveBeenCalled();
  });
});
