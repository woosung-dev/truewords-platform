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
  progress: { end_on: "2026-10-09", done_days: 7, missed_days: 0, remaining_days: 14, percent: 33, state: "active" },
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
    // 기본 21일 · 시작일 오늘(KST) · 알림 05:30. 가족 챌린지 토글은 W3 범위라 없다
    expect(screen.getByRole("radio", { name: /^21일/ })).toBeChecked();
    expect(screen.getByLabelText("시작일")).toHaveValue(TODAY);
    expect(screen.getByLabelText("알림 시각")).toHaveValue("05:30");
    expect(screen.queryByText(/가족 챌린지/)).toBeNull();
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
    expect(post.body).toEqual({
      topic: "감사",
      duration_days: 21,
      started_on: TODAY,
      reminder_time: "05:30",
    });
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

describe("홈 정성 카드 (SCR-PWA-002)", () => {
  it("진행 중이면 D-N · 진행 바 · 제목을 보여주고 그만하기는 확인을 거친다", async () => {
    loggedIn();
    on("GET", "/hoondok/me/jeongseong", () => json({ period: PERIOD }));
    on("DELETE", "/hoondok/me/jeongseong", () => new Response(null, { status: 204 }));
    render(wrap(<JeongseongCard />));

    expect(await screen.findByText("21일 새벽 정성 · 감사")).toBeInTheDocument();
    expect(screen.getByText("D-14")).toBeInTheDocument();
    expect(screen.getByText("7 / 21일")).toBeInTheDocument();
    expect(screen.getByText("매일 오전 5:30")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "정성 진행률" });
    expect(bar).toHaveAttribute("aria-valuenow", "33");
    expect(bar.firstElementChild).toHaveStyle({ width: "33%" });

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

  it("시작 전(upcoming)이면 시작일 배지를 단다", async () => {
    loggedIn();
    const upcoming: JeongseongPeriodResponse = {
      ...PERIOD,
      started_on: "2026-10-01",
      reminder_time: null,
      progress: { ...PERIOD.progress, state: "upcoming", done_days: 0, percent: 0 },
    };
    on("GET", "/hoondok/me/jeongseong", () => json({ period: upcoming }));
    render(wrap(<JeongseongCard />));

    expect(await screen.findByText("시작 전 · 10월 1일부터")).toBeInTheDocument();
    expect(screen.queryByText(/매일 오전/)).toBeNull();
  });

  it("비로그인 홈에서는 아무것도 그리지 않는다", async () => {
    loggedOut();
    const { container } = render(wrap(<JeongseongCard />));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/hoondok/me/jeongseong"))).toBe(false);
  });
});
