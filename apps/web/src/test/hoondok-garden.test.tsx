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
  duration_days: 21,
  started_on: "2026-09-04",
  reminder_time: null,
  status: "active",
  progress: { end_on: "2026-09-24", done_days: 7, missed_days: 0, remaining_days: 14, percent: 33, state: "active" },
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
    expect(screen.getByLabelText("9월 3일 아직")).toBeInTheDocument();
    expect(screen.getByLabelText("9월 10일 오늘 완료")).toBeInTheDocument();
    // 범례는 완료·아직 2개 — "쉼" 은 데이터가 없어 그리지 않는다
    expect(container.querySelectorAll(".gd-cal__legend > span")).toHaveLength(2);
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

  it("오늘이 아직이면 레이블이 '오늘 아직' 이다", () => {
    render(<MonthCalendar month={MONTH} days={DAYS} today="2026-09-11" />);
    expect(screen.getByLabelText("9월 11일 오늘 아직")).toBeInTheDocument();
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

  it("진행 중인 정성이 없으면 '새로 시작' 링크가 홈 시트로 간다", async () => {
    loggedIn(null);
    renderGarden();

    expect(await screen.findByRole("heading", { name: "진행 중인 정성이 없어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새로 시작" })).toHaveAttribute("href", "/hoondok?sheet=jeongseong");
  });

  it("진행 중인 정성이 있으면 D-N · 진행률 숫자 · 밀린 날을 함께 적는다", async () => {
    loggedIn();
    renderGarden();

    expect(await screen.findByText("21일 새벽 정성 · 가정의 화목")).toBeInTheDocument();
    expect(screen.getByText("D-14")).toBeInTheDocument();
    expect(screen.getByText("7 / 21일 · 33%")).toBeInTheDocument();
    expect(screen.getByText("밀린 날 0")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "정성 진행률" });
    expect(bar).toHaveAttribute("aria-valuenow", "33");
    expect(bar.firstElementChild).toHaveStyle({ width: "33%" });
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
