import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, kstTodayIso } from "@/features/hoondok/dates";
import type { DailyReading } from "@/features/hoondok/types";

const mockList = vi.fn();
vi.mock("@/features/hoondok/api", () => ({
  hoondokAPI: {
    list: (...args: unknown[]) => mockList(...args),
  },
}));

import HoondokReadingsPage from "@/app/(dashboard)/hoondok/page";

const TODAY = kstTodayIso();

function reading(overrides: Partial<DailyReading>): DailyReading {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    reading_date: TODAY,
    title: "오늘 말씀",
    body: "본문",
    speaker: "참어머님",
    spoken_on: null,
    work_title: "말씀 모음",
    edition: null,
    authority_grade: "R",
    review_status: "unverified",
    source_note: null,
    chunk_id: null,
    estimated_minutes: 3,
    created_at: "2026-09-19T00:00:00",
    updated_at: "2026-09-19T00:00:00",
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HoondokReadingsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockList.mockReset();
});

describe("훈독 편성 목록", () => {
  it("오늘~+14일을 명시해 조회하고 15행을 만든다 — 편성 없는 날은 미편성", async () => {
    mockList.mockResolvedValue([
      reading({}),
      reading({
        id: "22222222-2222-2222-2222-222222222222",
        reading_date: addDays(TODAY, 3),
        title: "철회된 말씀",
        authority_grade: "O1",
        review_status: "withdrawn",
      }),
    ]);
    const { container } = renderPage();

    await waitFor(() => expect(screen.getByText("오늘 말씀")).toBeInTheDocument());
    expect(mockList).toHaveBeenCalledWith(TODAY, addDays(TODAY, 14));

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(15);
    expect(screen.getAllByText("미편성")).toHaveLength(13);
    expect(container.querySelectorAll("tr[data-today]")).toHaveLength(1);
    expect(container.querySelector("tr[data-today]")?.getAttribute("data-date")).toBe(TODAY);
    expect(screen.getByText("편성 2일 · 미편성 13일", { exact: false })).toBeInTheDocument();

    // 배지: 시드 R·unverified, 철회 건 O1·withdrawn
    expect(screen.getByText("권리 확인 중")).toBeInTheDocument();
    expect(screen.getByText("확인되지 않음")).toBeInTheDocument();
    expect(screen.getByText("철회")).toBeInTheDocument();
    expect(screen.getByText("철회된 말씀")).toHaveClass("line-through");

    // 액션 링크
    const editLinks = screen.getAllByRole("link", { name: /편집/ });
    expect(editLinks).toHaveLength(2);
    expect(editLinks[0]).toHaveAttribute("href", "/hoondok/11111111-1111-1111-1111-111111111111/edit");
    const createLinks = screen.getAllByRole("link", { name: /편성하기/ });
    expect(createLinks).toHaveLength(13);
    expect(createLinks[0]).toHaveAttribute("href", `/hoondok/new?date=${addDays(TODAY, 1)}`);
  });

  it("조회 실패 시 오류 카드와 다시 시도", async () => {
    mockList.mockRejectedValue(new Error("boom"));
    renderPage();
    await waitFor(() => expect(screen.getByText("편성 목록을 불러올 수 없습니다.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
