import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, formatDayLabel, kstTodayIso } from "@/features/hoondok/dates";
import { scheduleStock } from "@/features/hoondok/stock";
import type { DailyReading, ReviewStatus } from "@/features/hoondok/types";

const mockList = vi.fn();
vi.mock("@/features/hoondok/api", () => ({
  hoondokAPI: {
    list: (...args: unknown[]) => mockList(...args),
  },
}));

import HoondokReadingsPage from "@/app/(dashboard)/hoondok/page";
import { ScheduleStockNavBadge } from "@/features/hoondok/components/schedule-stock";

const TODAY = "2026-09-29";

function reading(
  reading_date: string,
  review_status: ReviewStatus = "reviewed",
  id = `id-${reading_date}`,
): DailyReading {
  return {
    id,
    reading_date,
    title: `말씀 ${reading_date}`,
    body: "본문",
    speaker: "참아버님",
    spoken_on: null,
    work_title: "천성경",
    edition: null,
    authority_grade: "O1",
    review_status,
    source_note: null,
    chunk_id: null,
    estimated_minutes: 3,
    created_at: "2026-09-19T00:00:00",
    updated_at: "2026-09-19T00:00:00",
  };
}

/** today 부터 n 일 연속 편성. */
function filled(today: string, n: number): DailyReading[] {
  return Array.from({ length: n }, (_, i) => reading(addDays(today, i)));
}

describe("scheduleStock — 편성 재고 계산", () => {
  it("오늘부터 끊기지 않은 날 수와 첫 빈 날", () => {
    // 3일 연속 뒤 빈 날, 그 뒤 편성이 또 있어도 재고는 3일이다(중간 빈 날을 숨기지 않는다).
    const stock = scheduleStock([...filled(TODAY, 3), reading(addDays(TODAY, 6))], TODAY);
    expect(stock).toEqual({ days: 3, firstGap: addDays(TODAY, 3), level: "warning" });
  });

  it("철회는 빈 날로 센다", () => {
    const readings = filled(TODAY, 5);
    readings[2] = reading(addDays(TODAY, 2), "withdrawn");
    expect(scheduleStock(readings, TODAY)).toMatchObject({ days: 2, firstGap: addDays(TODAY, 2) });
    // 미검수(unverified)는 사용자에게 보이므로 재고다
    expect(scheduleStock([reading(TODAY, "unverified")], TODAY)).toMatchObject({ days: 1 });
  });

  it("오늘이 비면 0일 · 위험, 첫 빈 날은 오늘", () => {
    expect(scheduleStock([], TODAY)).toEqual({ days: 0, firstGap: TODAY, level: "danger" });
    expect(scheduleStock(filled(addDays(TODAY, 1), 10), TODAY)).toEqual({ days: 0, firstGap: TODAY, level: "danger" });
  });

  it("15일 모두 차 있으면 첫 빈 날 없음", () => {
    expect(scheduleStock(filled(TODAY, 15), TODAY)).toEqual({ days: 15, firstGap: null, level: "ok" });
  });

  it.each([
    [0, "danger"],
    [1, "warning"],
    [6, "warning"],
    [7, "ok"],
  ] as const)("경계값 %i일 → %s", (n, level) => {
    expect(scheduleStock(filled(TODAY, n), TODAY)).toMatchObject({ days: n, level });
  });
});

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("편성 목록 재고 배너", () => {
  const today = kstTodayIso();

  beforeEach(() => {
    mockList.mockReset();
  });

  it("0일: 위험 배너 · 오늘 편성하기", async () => {
    mockList.mockResolvedValue([]);
    renderWithClient(<HoondokReadingsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("오늘 말씀이 비어 있어요");
    expect(screen.getByRole("link", { name: "오늘 편성하기" })).toHaveAttribute("href", `/hoondok/new?date=${today}`);
    expect(document.querySelector('tr[data-first-gap="true"]')?.getAttribute("data-date")).toBe(today);
  });

  it("1일: 내일부터 비어 있다고 말하고 첫 빈 날로 간다", async () => {
    mockList.mockResolvedValue(filled(today, 1));
    renderWithClient(<HoondokReadingsPage />);
    const gap = addDays(today, 1);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(`앞으로 1일분 남았어요. 내일 ${formatDayLabel(gap)}부터 비어 있어요`);
    expect(screen.getByRole("link", { name: `${formatDayLabel(gap)} 편성하기` })).toHaveAttribute(
      "href",
      `/hoondok/new?date=${gap}`,
    );
  });

  it("6일: 경고 · 7일분 기준 안내", async () => {
    mockList.mockResolvedValue(filled(today, 6));
    renderWithClient(<HoondokReadingsPage />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(`앞으로 6일분 남았어요. ${formatDayLabel(addDays(today, 6))}부터 비어 있어요`);
    expect(status).toHaveTextContent("7일분 이상 채워 두면 안심이에요");
  });

  it("7일: 상자 없는 한 줄 · 마지막 날까지 · 첫 빈 날 표시 없음", async () => {
    mockList.mockResolvedValue(filled(today, 7));
    renderWithClient(<HoondokReadingsPage />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(`앞으로 7일분 채워져 있어요 · ${formatDayLabel(addDays(today, 6))}까지`);
    expect(screen.queryByRole("link", { name: /^\S+ \(\S\) 편성하기$/ })).toBeNull();
    expect(document.querySelector("tr[data-first-gap]")).toBeNull();
  });

  it("15일 모두: 목록 범위 이상 채워져 있다", async () => {
    mockList.mockResolvedValue(filled(today, 15));
    renderWithClient(<HoondokReadingsPage />);
    expect(await screen.findByRole("status")).toHaveTextContent("앞으로 15일분 이상 채워져 있어요");
  });

  it("첫 빈 날이 철회된 편성이면 새 편성 대신 그 편성 수정으로 간다(같은 날짜 새 편성은 409)", async () => {
    mockList.mockResolvedValue([reading(today), reading(addDays(today, 1), "withdrawn", "withdrawn-id")]);
    renderWithClient(<HoondokReadingsPage />);
    const link = await screen.findByRole("link", { name: `${formatDayLabel(addDays(today, 1))} 편성하기` });
    expect(link).toHaveAttribute("href", "/hoondok/withdrawn-id/edit");
  });

  it("조회 실패면 배너 없이 기존 오류 화면만", async () => {
    mockList.mockRejectedValue(new Error("boom"));
    renderWithClient(<HoondokReadingsPage />);
    await screen.findByText("편성 목록을 불러올 수 없습니다.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("KST 오늘 기준", () => {
  afterEach(() => vi.useRealTimers());

  it("UTC 15:00 이후에는 KST 다음날부터 조회하고 재고도 그날부터 센다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T15:30:00Z")); // KST 9/29 00:30
    mockList.mockReset();
    // UTC 날짜(9/28)에만 편성이 있고 KST 오늘(9/29)부터는 3일
    mockList.mockResolvedValue([reading("2026-09-28"), ...filled("2026-09-29", 3)]);
    renderWithClient(<HoondokReadingsPage />);
    const status = await screen.findByRole("status");
    expect(mockList).toHaveBeenCalledWith("2026-09-29", "2026-10-13");
    expect(status).toHaveTextContent("앞으로 3일분 남았어요. 10/2 (금)부터 비어 있어요");
  });
});

describe("사이드바 재고 배지", () => {
  const today = kstTodayIso();

  beforeEach(() => {
    mockList.mockReset();
  });

  it("1~6일은 남은 일수, 0일은 오늘 편성 없음을 글자로 말한다", async () => {
    mockList.mockResolvedValue(filled(today, 3));
    const { unmount } = renderWithClient(<ScheduleStockNavBadge />);
    expect(await screen.findByText("3일")).toBeInTheDocument();
    expect(screen.getByText("3일분 남음")).toHaveClass("sr-only");
    unmount();

    mockList.mockResolvedValue([]);
    renderWithClient(<ScheduleStockNavBadge />);
    expect(await screen.findByText("0일")).toBeInTheDocument();
    expect(screen.getByText("오늘 편성 없음")).toHaveClass("sr-only");
  });

  it("7일 이상이면 배지를 그리지 않는다", async () => {
    mockList.mockResolvedValue(filled(today, 7));
    const { container } = renderWithClient(<ScheduleStockNavBadge />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("편성 화면과 같은 쿼리 키라 함께 떠도 요청은 한 번", async () => {
    mockList.mockResolvedValue(filled(today, 2));
    renderWithClient(
      <>
        <ScheduleStockNavBadge />
        <HoondokReadingsPage />
      </>,
    );
    expect(await screen.findByText("2일")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("앞으로 2일분 남았어요");
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(today, addDays(today, 14));
  });
});
