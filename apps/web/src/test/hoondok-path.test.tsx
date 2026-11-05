// 7일 정성 (읽기 정성 1a) 웹: 이번 주 읽은 날(월요일 시작) · 돌아온 날 시트 조건 · 부엉이 OFF 배치 · 정성 플래그 OFF.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => ({ get: () => null }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import HoondokPathDonePage from "@/app/(hoondok)/path/done/page";
import HoondokPathPage from "@/app/(hoondok)/path/page";
import HoondokPathReadPage from "@/app/(hoondok)/path/read/[day]/page";
import { WeekStrip } from "@/components/hoondok";
import type { PathRunView, PathStepSummary } from "@/features/hoondok/path/api";
import { PathReturnSheet, PathStepList } from "@/features/hoondok/path/components/path-home";
import { PathHomeSlot } from "@/features/hoondok/path/components/path-home-slot";
import { stepWindow, weekDoneByDay, withEul } from "@/features/hoondok/path/format";
import { dismissReturnSheet, returnSheetKey, shouldOfferReturn } from "@/features/hoondok/path/return-sheet";

const TITLES = Array.from({ length: 7 }, (_, i) => `천성경 1편 ${i + 1}장`);

function makeRun(overrides: Partial<PathRunView> = {}): PathRunView {
  const steps: PathStepSummary[] = TITLES.map((title, i) => ({
    day_index: i + 1,
    title,
    estimated_minutes: 7,
    state: i < 2 ? "done" : i === 2 ? "next" : "upcoming",
    volume: "천성경",
    start_chunk_index: i * 10,
    end_chunk_index: i * 10 + 9,
    completed_on: null,
    note: null,
  }));
  return {
    id: "run-1",
    slug: "cs7",
    title: "천성경 7일 정성",
    book: "천성경",
    duration_days: 7,
    minutes_tier: 7,
    preferred_slot: "dawn",
    status: "active",
    started_on: "2026-11-01",
    today: "2026-11-04",
    day_no: 4,
    end_on: "2026-11-07",
    overdue: false,
    total_steps: 7,
    done_steps: 2,
    next_step: 3,
    read_today: false,
    gap_days: 0,
    week_read_dates: [],
    read_days: 2,
    finished_at: null,
    steps,
    ...overrides,
  };
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("이번 주 읽은 날 (월요일 시작 주 — 홈 '이번 주'와 같은 칸)", () => {
  it("서버 week_read_dates 를 월요일=0 칸으로 옮기고 지난주·오늘 뒤 날짜는 버린다", () => {
    // 2026-11-04 는 수요일 — 이번 주는 11-02(월)부터다
    const done = weekDoneByDay("2026-11-04", ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-06"]);
    expect(done).toEqual([true, false, true, false, false, false, false]);
  });

  it("오늘이 일요일이면 마지막 칸이고 그 주 월요일부터 센다", () => {
    expect(weekDoneByDay("2026-11-08", ["2026-11-01", "2026-11-02", "2026-11-08"])).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("WeekStrip 은 보조기기 이름을 바꿔 쓸 수 있다", () => {
    render(<WeekStrip label="이번 주 읽은 날" doneLabel="읽음" todayWeekday={3} doneByDay={[true]} />);
    expect(screen.getByRole("list", { name: "이번 주 읽은 날" })).toBeTruthy();
    expect(screen.getByLabelText("월요일 · 읽음")).toBeTruthy();
  });

  it("기본 WeekStrip 은 그대로 월요일 시작이다", () => {
    const { container } = render(<WeekStrip todayWeekday={0} />);
    const days = container.querySelectorAll(".week__day");
    expect(days[0].textContent).toBe("월");
    expect(days[6].getAttribute("aria-current")).toBe("date");
  });
});

describe("문구 도우미", () => {
  it("받침에 맞춰 조사를 고른다", () => {
    expect(withEul("천성경 7일 정성")).toBe("천성경 7일 정성을");
  });

  it("21장 정성은 다음 장을 넷째 칸쯤에 두는 7칸 창이다", () => {
    const steps = Array.from({ length: 21 }, (_, i) => ({ ...makeRun().steps[0], day_index: i + 1 }));
    expect(stepWindow(steps, 10).map((s) => s.day_index)).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(stepWindow(steps, 2)[0].day_index).toBe(1);
    expect(stepWindow(steps, 21).at(-1)?.day_index).toBe(21);
  });
});

describe("돌아온 날 시트 조건", () => {
  it("빈 날 2일 이상 · 오늘 안 읽음 · 진행 중일 때만 띄운다", () => {
    expect(shouldOfferReturn(makeRun({ gap_days: 2 }))).toBe(true);
    expect(shouldOfferReturn(makeRun({ gap_days: 1 }))).toBe(false);
    expect(shouldOfferReturn(makeRun({ gap_days: 3, read_today: true }))).toBe(false);
    expect(shouldOfferReturn(makeRun({ gap_days: 3, status: "completed" }))).toBe(false);
    expect(shouldOfferReturn(makeRun({ gap_days: 3, next_step: null }))).toBe(false);
  });

  it("조건이 맞으면 시트가 열리고 쉰 날 수·부엉이 없이 평소대로 읽기 / 나중에 두 가지만 있다", () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_MASCOT", "1");
    const run = makeRun({ gap_days: 4 });
    render(<PathReturnSheet run={run} next={run.steps[2]} />);
    const dialog = screen.getByRole("dialog", { name: "쉬었다 오셔도 괜찮아요" });
    expect(dialog.querySelector(".owl")).toBeNull();
    expect(dialog.textContent).not.toMatch(/4일|일째|놓쳤/);
    expect(screen.getByRole("link", { name: "평소대로 읽기" }).getAttribute("href")).toBe("/path/read/3");
    expect(screen.getByRole("button", { name: "나중에" })).toBeTruthy();
    expect(screen.queryByText(/앞부분만|다시 보기/)).toBeNull();
  });

  it("같은 날 이미 닫았으면 다시 띄우지 않는다(run·서버 오늘 날짜 키)", () => {
    const run = makeRun({ gap_days: 4 });
    dismissReturnSheet(run.id, run.today);
    expect(window.localStorage.getItem(returnSheetKey(run.id, run.today))).toBe("1");
    const { container } = render(<PathReturnSheet run={run} next={run.steps[2]} />);
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("다음 날이면 같은 run 이어도 다시 띄운다", () => {
    const run = makeRun({ gap_days: 4 });
    dismissReturnSheet(run.id, "2026-11-03");
    render(<PathReturnSheet run={run} next={run.steps[2]} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("장 목록 부엉이 자리", () => {
  it("마스코트 ON 이면 다음 장 행에만 reading 40 부엉이가 있다", () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_MASCOT", "1");
    const { container } = render(<PathStepList run={makeRun()} />);
    const owls = container.querySelectorAll("img.owl");
    expect(owls).toHaveLength(1);
    expect(owls[0].getAttribute("src")).toBe("/hoondok/mascot/owl-reading.webp");
    expect(owls[0].getAttribute("width")).toBe("40");
    expect(owls[0].closest(".path-step")?.getAttribute("aria-current")).toBe("step");
  });

  it("오늘 읽은 뒤에도 부엉이는 다음 장 옆에 그대로 있다", () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_MASCOT", "1");
    const { container } = render(<PathStepList run={makeRun({ read_today: true })} />);
    const owl = container.querySelector("img.owl");
    expect(owl?.closest(".path-step")?.textContent).toContain("내일 읽을 장");
  });

  it("마스코트 OFF 면 부엉이 자리에 감싸는 요소도 남지 않는다(빈칸 없음)", () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_MASCOT", "");
    const { container } = render(<PathStepList run={makeRun()} />);
    expect(container.querySelector(".owl")).toBeNull();
    const next = container.querySelector('.path-step[data-state="next"]');
    // 보조기기 문장 · 번호 원 · 글자 — 셋째 칸이 없다
    expect(next?.children).toHaveLength(3);
    expect(next?.textContent).toContain("오늘 읽을 장");
  });

  it("행마다 보조기기용 상태 문장이 있다", () => {
    render(<PathStepList run={makeRun()} />);
    expect(screen.getByText("3번째 장, 천성경 1편 3장, 오늘 읽을 장")).toBeTruthy();
    expect(screen.getByText("1번째 장, 천성경 1편 1장, 읽음")).toBeTruthy();
  });
});

describe("정성 플래그 OFF", () => {
  it("홈 자리는 기존 블록만 그대로 그리고 정성 조회를 보내지 않는다", () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_PATHS", "");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      wrap(
        <PathHomeSlot>
          <p>기존 홈</p>
        </PathHomeSlot>,
      ),
    );
    expect(container.innerHTML).toBe("<p>기존 홈</p>");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("path-runs"))).toBe(false);
  });

  it("/path · /path/read/[day] · /path/done 은 404 다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_PATHS", "");
    expect(() => HoondokPathPage()).toThrow("NEXT_NOT_FOUND");
    expect(() => HoondokPathDonePage()).toThrow("NEXT_NOT_FOUND");
    await expect(HoondokPathReadPage({ params: Promise.resolve({ day: "1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("플래그 ON 이어도 잘못된 장 번호는 404 다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_PATHS", "1");
    await expect(HoondokPathReadPage({ params: Promise.resolve({ day: "abc" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(HoondokPathReadPage({ params: Promise.resolve({ day: "0" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("플래그 ON · 비로그인이면 시작 카드가 기존 블록 앞에 온다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_PATHS", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ message: "로그인이 필요합니다" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    render(
      wrap(
        <PathHomeSlot>
          <p>기존 홈</p>
        </PathHomeSlot>,
      ),
    );
    await waitFor(() => expect(screen.getByRole("link", { name: "정성 시작하기" }).getAttribute("href")).toBe("/path"));
    expect(screen.getByText("기존 홈")).toBeTruthy();
  });
});
