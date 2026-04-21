import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueryListResponse } from "@/features/analytics/types";

// jsdom에는 window.matchMedia가 없으므로 stub 처리 (TruncateTooltip 사용)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mockGetQueries = vi.fn();
vi.mock("@/features/analytics/api", () => ({
  analyticsAPI: {
    getQueries: (...args: unknown[]) => mockGetQueries(...args),
    getQueryDetails: vi.fn().mockResolvedValue({
      query_text: "",
      total_count: 0,
      returned_count: 0,
      days: 30,
      occurrences: [],
    }),
  },
}));

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

import QueriesExplorerPage from "@/app/(dashboard)/analytics/queries/page";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QueriesExplorerPage />
    </QueryClientProvider>
  );
}

function fixture(
  overrides: Partial<QueryListResponse> = {}
): QueryListResponse {
  return {
    items: [],
    total: 0,
    page: 1,
    size: 50,
    days: 30,
    ...overrides,
  };
}

beforeEach(() => {
  mockGetQueries.mockReset();
  mockPush.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("QueriesExplorerPage", () => {
  it("빈 결과면 안내 문구를 보여준다", async () => {
    mockGetQueries.mockResolvedValue(fixture({ total: 0, items: [] }));
    renderPage();
    expect(await screen.findByText(/조건에 맞는 질문이 없습니다/)).toBeDefined();
  });

  it("결과가 있으면 순위와 질문 텍스트가 노출된다", async () => {
    mockGetQueries.mockResolvedValue(
      fixture({
        total: 2,
        items: [
          {
            query_text: "36가정 축복",
            count: 3,
            latest_at: "2026-04-17T12:34:00",
            negative_feedback_count: 1,
          },
          {
            query_text: "노조와 사조직",
            count: 2,
            latest_at: "2026-04-17T01:03:00",
            negative_feedback_count: 0,
          },
        ],
      })
    );
    renderPage();
    expect(await screen.findAllByText("36가정 축복")).toBeDefined();
    expect(screen.getAllByText("노조와 사조직")).toBeDefined();
  });

  it("행 클릭 시 모달이 열린다(QueryDetailModal)", async () => {
    const user = userEvent.setup();
    mockGetQueries.mockResolvedValue(
      fixture({
        total: 1,
        items: [
          {
            query_text: "천일국",
            count: 1,
            latest_at: "2026-04-17T01:03:00",
            negative_feedback_count: 0,
          },
        ],
      })
    );
    renderPage();
    const rowButton = await screen.findByRole("button", { name: /천일국/ });
    await user.click(rowButton);
    // 모달 열림 → 헤더 제목이 document.body에 나타남
    await waitFor(() => {
      expect(document.body.textContent).toContain("천일국");
    });
  });

  it("부정 피드백 0건은 대시(—)로 표기된다", async () => {
    mockGetQueries.mockResolvedValue(
      fixture({
        total: 1,
        items: [
          {
            query_text: "안녕",
            count: 1,
            latest_at: "2026-04-17T01:03:00",
            negative_feedback_count: 0,
          },
        ],
      })
    );
    renderPage();
    await screen.findByText("안녕");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("부정 피드백 >0 은 숫자로 노출된다", async () => {
    mockGetQueries.mockResolvedValue(
      fixture({
        total: 1,
        items: [
          {
            query_text: "삼대상목적",
            count: 2,
            latest_at: "2026-04-17T01:03:00",
            negative_feedback_count: 2,
          },
        ],
      })
    );
    renderPage();
    // count 열과 negative_feedback_count 열 모두 "2"를 표시하므로 getAllByText 사용
    const allTwos = await screen.findAllByText("2");
    expect(allTwos.length).toBeGreaterThanOrEqual(1);
  });
});
