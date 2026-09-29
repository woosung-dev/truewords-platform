import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
const mockReplace = vi.fn();
let sheetParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, prefetch: vi.fn() }),
  usePathname: () => "/hoondok",
  useSearchParams: () => ({ get: (key: string) => (key === "sheet" ? sheetParam : null) }),
}));

import { JeongseongCard } from "@/features/hoondok/jeongseong/components/jeongseong-card";
import { JeongseongSheet } from "@/features/hoondok/jeongseong/components/jeongseong-sheet";
import { jeongseongDayProgress } from "@/features/hoondok/jeongseong/format";
import type { JeongseongPeriodResponse } from "@/features/hoondok/jeongseong-api";
import { formatKstDate } from "@/features/hoondok/today";
import type { HoondokUser } from "@/features/identity/types";

// API 모듈을 mock 하지 않고 fetch 만 바꿔 끼운다 — 헤더·상태 코드 변환까지 실제 경로로 검증한다.
const fetchMock = vi.fn<typeof fetch>();
const routes = new Map<string, Array<() => Response>>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
/** `on("POST", "/hoondok/me/jeongseong", …)` — 응답이 여러 개면 호출 순서대로, 하나면 계속 같은 값. */
function on(method: string, path: string, ...makers: Array<() => Response>) {
  routes.set(`${method} ${path}`, makers);
}

const USER: HoondokUser = { id: "u1", email: "a@b.c", display_name: "효진" };
const TODAY = formatKstDate().iso;
const PERIOD: JeongseongPeriodResponse = {
  id: "p1",
  topic: "감사",
  duration_days: 21,
  started_on: "2026-09-19",
  reminder_time: "05:30:00",
  status: "active",
  // 7일차(21 - 14)에 읽은 날은 5일 — 일차와 읽은 날을 일부러 다르게 둬 화면이 done 기준 값을 쓰면 잡히게 한다
  progress: { end_on: "2026-10-09", done_days: 5, missed_days: 1, remaining_days: 14, percent: 24, state: "active" },
};

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function loggedIn() {
  on("GET", "/hoondok/auth/me", () => json({ user: USER }));
}
function loggedOut() {
  on("GET", "/hoondok/auth/me", () => json({ message: "로그인이 필요합니다" }, 401));
}
/** 마지막 POST 요청의 본문·헤더 */
function lastPost() {
  const call = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").at(-1);
  const [input, init] = call ?? [];
  return {
    url: String(input instanceof Request ? input.url : input),
    body: JSON.parse(String(init?.body ?? "{}")),
    headers: new Headers(init?.headers),
  };
}

beforeEach(() => {
  sheetParam = null;
  routes.clear();
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    for (const [key, makers] of routes) {
      const [routeMethod, routePath] = key.split(" ");
      if (routeMethod !== method || !url.includes(routePath)) continue;
      const maker = makers.length > 1 ? makers.shift() : makers[0];
      if (maker) return maker();
    }
    return json({ message: `핸들러 없음: ${method} ${url}` }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("정성 시트 (SCR-PWA-004)", () => {
  it("?sheet 가 없으면 시트를 마운트하지 않는다", async () => {
    loggedIn();
    render(wrap(<JeongseongSheet />));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("?sheet=jeongseong 이면 제목·기간 라디오와 함께 열린다", async () => {
    loggedIn();
    sheetParam = "jeongseong";
    render(wrap(<JeongseongSheet />));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "정성 기간 만들기" })).toBeInTheDocument();
    for (const days of ["7", "21", "40"]) {
      expect(screen.getByRole("radio", { name: new RegExp(`^${days}일`) })).toBeInTheDocument();
    }
    // 기본 21일 · 시작일 오늘(KST). 가족 챌린지 토글은 W3 범위라 없다
    expect(screen.getByRole("radio", { name: /^21일/ })).toBeChecked();
    expect(screen.getByLabelText("시작일")).toHaveValue(TODAY);
    expect(screen.queryByText(/가족 챌린지/)).toBeNull();
    // 정성 알림은 훈독하기 알림에 합쳤다 — 시각 입력 대신 설정으로 가는 링크만 있다
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(screen.queryByLabelText(/알림 시각/)).toBeNull();
    expect(screen.getByRole("link", { name: "설정 › 훈독하기" })).toHaveAttribute("href", "/hoondok/settings");
    expect(screen.getByText(/에서 켜고 시각을 정해요/)).toBeInTheDocument();
  });

  it("21일 · 주제 '감사' 제출 → POST 본문과 CSRF 헤더, 성공하면 홈으로 닫는다", async () => {
    loggedIn();
    on("POST", "/hoondok/me/jeongseong", () => json(PERIOD, 201));
    sheetParam = "jeongseong";
    render(wrap(<JeongseongSheet />));

    fireEvent.click(await screen.findByRole("button", { name: "감사" }));
    fireEvent.submit(screen.getByRole("form", { name: "정성 기간 만들기" }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/hoondok", { scroll: false }));
    const post = lastPost();
    expect(post.url).toBe("/api/backend/hoondok/me/jeongseong");
    // reminder_time 은 보내지 않는다 (알림 시각은 설정 › 훈독하기 한 곳)
    expect(post.body).toEqual({
      topic: "감사",
      duration_days: 21,
      started_on: TODAY,
    });
    expect(post.body).not.toHaveProperty("reminder_time");
    expect(post.headers.get("X-Requested-With")).toBe("XMLHttpRequest");
  });

  it("409 는 '이미 진행 중인 정성' 안내로 남고 시트는 닫지 않는다", async () => {
    loggedIn();
    on("POST", "/hoondok/me/jeongseong", () => json({ message: "이미 진행 중인 정성 기간이 있어요" }, 409));
    sheetParam = "jeongseong";
    render(wrap(<JeongseongSheet />));

    fireEvent.click(await screen.findByRole("button", { name: "감사" }));
    fireEvent.submit(screen.getByRole("form", { name: "정성 기간 만들기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("이미 진행 중인 정성이 있어요");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("401 은 안내 대신 온보딩으로 보낸다 (returnTo 가 시트를 다시 연다)", async () => {
    loggedIn();
    on("POST", "/hoondok/me/jeongseong", () => json({ message: "로그인이 필요합니다" }, 401));
    sheetParam = "jeongseong";
    render(wrap(<JeongseongSheet />));

    fireEvent.click(await screen.findByRole("button", { name: "감사" }));
    fireEvent.submit(screen.getByRole("form", { name: "정성 기간 만들기" }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/hoondok/onboarding?returnTo=%2Fhoondok%3Fsheet%3Djeongseong"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("비로그인이 시트를 열면 폼 대신 로그인 안내를 보여준다", async () => {
    loggedOut();
    sheetParam = "jeongseong";
    render(wrap(<JeongseongSheet />));

    expect(await screen.findByRole("link", { name: "로그인하고 시작하기" })).toHaveAttribute(
      "href",
      "/hoondok/onboarding?returnTo=%2Fhoondok%3Fsheet%3Djeongseong",
    );
    expect(screen.queryByRole("form", { name: "정성 기간 만들기" })).toBeNull();
  });

  it("Esc(close 이벤트)와 배경막 클릭은 URL 의 sheet 를 지운다", async () => {
    loggedIn();
    sheetParam = "jeongseong";
    render(wrap(<JeongseongSheet />));
    const dialog = await screen.findByRole("dialog");

    // Esc 는 <dialog>.showModal() 이 close 이벤트로 알려 준다 — 화면은 URL 만 바꾼다
    fireEvent(dialog, new Event("close"));
    expect(mockReplace).toHaveBeenCalledWith("/hoondok", { scroll: false });

    // 배경막(패널 밖) 클릭도 dialog 가 받는다. 패널 안 클릭은 닫지 않는다.
    mockReplace.mockClear();
    fireEvent.click(screen.getByRole("heading", { name: "정성 기간 만들기" }));
    expect(mockReplace).not.toHaveBeenCalled();
    fireEvent.click(dialog);
    expect(mockReplace).toHaveBeenCalledWith("/hoondok", { scroll: false });
  });
});

describe("정성 날짜 기준 진행 jeongseongDayProgress", () => {
  const period = (
    remaining_days: number,
    state: "active" | "upcoming" | "completed" = "active",
    duration_days = 21,
  ) => ({
    duration_days,
    progress: { ...PERIOD.progress, remaining_days, state },
  });

  it("일차 = 기간 − 남은 날, 막대 = 일차 / 기간 (읽은 날 수와 무관)", () => {
    // 시작한 날: 1일차 · 20일 남음 · 5%
    expect(jeongseongDayProgress(period(20))).toEqual({ day: 1, remainingDays: 20, percent: 5 });
    // 시작 −7일: 8일차 · 13일 남음 · 38%
    expect(jeongseongDayProgress(period(13))).toEqual({ day: 8, remainingDays: 13, percent: 38 });
    // done_days·percent 를 바꿔도 결과가 같다
    expect(
      jeongseongDayProgress({ duration_days: 21, progress: { ...PERIOD.progress, done_days: 0, percent: 0 } }),
    ).toEqual({ day: 7, remainingDays: 14, percent: 33 });
  });

  it("마지막 날은 기간일차 · 남은 날 0 · 100%, 끝난 뒤에도 마지막 날에 멈춘다", () => {
    expect(jeongseongDayProgress(period(0))).toEqual({ day: 21, remainingDays: 0, percent: 100 });
    expect(jeongseongDayProgress(period(0, "completed", 7))).toEqual({ day: 7, remainingDays: 0, percent: 100 });
  });

  it("40일 기간의 반올림은 half-up 이다 (1일차 3%, 3일차 8%)", () => {
    expect(jeongseongDayProgress(period(39, "active", 40))?.percent).toBe(3);
    expect(jeongseongDayProgress(period(37, "active", 40))?.percent).toBe(8);
  });

  it("시작 전이면 null — 막대를 그리지 않는다", () => {
    expect(jeongseongDayProgress(period(30, "upcoming"))).toBeNull();
  });
});

describe("홈 정성 카드 (SCR-PWA-002)", () => {
  it("진행 중이면 N일차 · 날짜 기준 막대 · 시작일 · 남은 날을 보여주고 그만하기는 확인을 거친다", async () => {
    loggedIn();
    on("GET", "/hoondok/me/jeongseong", () => json({ period: PERIOD }));
    on("DELETE", "/hoondok/me/jeongseong", () => new Response(null, { status: 204 }));
    const { container } = render(wrap(<JeongseongCard />));

    expect(await screen.findByText("21일 정성 · 감사")).toBeInTheDocument();
    expect(screen.getByText("7일차")).toBeInTheDocument();
    expect(screen.getByText("9월 19일에 시작했어요")).toBeInTheDocument();
    expect(screen.getByText("14일 남았어요")).toBeInTheDocument();
    // 예전 기간에 저장된 reminder_time 이 있어도 카드는 시각을 쓰지 않는다 — 알림은 훈독하기 시각 하나다
    expect(screen.queryByText(/매일 오전/)).toBeNull();
    // 막대는 일차 / 기간(7/21 = 33%)이다. 읽은 날 기준 percent(24)를 쓰지 않는다
    const bar = screen.getByRole("progressbar", { name: "21일 정성 중 7일차" });
    expect(bar).toHaveAttribute("aria-valuenow", "7");
    expect(bar).toHaveAttribute("aria-valuemax", "21");
    expect(bar.firstElementChild).toHaveStyle({ width: "33%" });
    // 빠진 날을 셀 수 있는 표시는 없다 — 읽은 날 수·분수·퍼센트·D-day·"새벽" (DEC-PWA-023)
    const text = container.textContent ?? "";
    for (const banned of ["진행한 날", "/ 21일", "/21일", "%", "D-", "새벽", "밀린 날"])
      expect(text).not.toContain(banned);

    fireEvent.click(screen.getByRole("button", { name: "그만하기" }));
    expect(screen.getByText("이 정성을 그만할까요?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "네, 그만할래요" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
  });

  it("진행 중인 정성이 없으면 시트로 보내는 CTA 만 둔다", async () => {
    loggedIn();
    on("GET", "/hoondok/me/jeongseong", () => json({ period: null }));
    render(wrap(<JeongseongCard />));

    expect(await screen.findByRole("link", { name: "정성 시작하기" })).toHaveAttribute(
      "href",
      "/hoondok?sheet=jeongseong",
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("시작 전(upcoming)이면 막대 없이 시작일 배지만 단다", async () => {
    loggedIn();
    const upcoming: JeongseongPeriodResponse = {
      ...PERIOD,
      started_on: "2026-10-01",
      reminder_time: null,
      progress: { ...PERIOD.progress, state: "upcoming", done_days: 0, percent: 0, remaining_days: 29 },
    };
    on("GET", "/hoondok/me/jeongseong", () => json({ period: upcoming }));
    render(wrap(<JeongseongCard />));

    expect(await screen.findByText("시작 전 · 10월 1일부터")).toBeInTheDocument();
    expect(screen.getByText("21일 정성 · 감사")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/일차$/)).toBeNull();
    expect(screen.queryByText(/남았어요/)).toBeNull();
    expect(screen.queryByText(/매일 오전/)).toBeNull();
  });

  it("마지막 날은 '오늘이 마지막 날이에요' 로 적는다 — '0일 남았어요' 가 아니다", async () => {
    loggedIn();
    on("GET", "/hoondok/me/jeongseong", () =>
      json({ period: { ...PERIOD, progress: { ...PERIOD.progress, remaining_days: 0 } } }),
    );
    render(wrap(<JeongseongCard />));

    expect(await screen.findByText("21일차")).toBeInTheDocument();
    expect(screen.getByText("오늘이 마지막 날이에요")).toBeInTheDocument();
    expect(screen.queryByText(/0일 남았어요/)).toBeNull();
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "100%" });
  });

  it("비로그인 홈에서도 섹션과 시작 CTA 는 그리되 조회는 하지 않는다", async () => {
    loggedOut();
    render(wrap(<JeongseongCard />));
    // 값을 지어내지 않는다 — 진행 수치 없이 시작 CTA 만 두고 로그인 요구는 시트가 맡는다
    expect(await screen.findByRole("link", { name: "정성 시작하기" })).toHaveAttribute(
      "href",
      "/hoondok?sheet=jeongseong",
    );
    expect(screen.getByText("정성 기간")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/hoondok/me/jeongseong"))).toBe(false);
  });
});
