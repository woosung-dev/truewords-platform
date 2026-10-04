import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockChatbots = vi.fn();
const mockStatus = vi.fn();
const mockSummary = vi.fn();
const mockFeedbackList = vi.fn();

vi.mock("@/features/chatbot/api", () => ({
  chatbotAPI: { list: (...args: unknown[]) => mockChatbots(...args) },
}));
vi.mock("@/features/data-source/api", () => ({
  dataAPI: { getStatus: () => mockStatus() },
}));
vi.mock("@/features/analytics/api", () => ({
  analyticsAPI: {
    getDashboardSummary: () => mockSummary(),
    getFeedbackList: (...args: unknown[]) => mockFeedbackList(...args),
    getSessionDetail: vi.fn(),
  },
}));

import DashboardPage from "@/app/(dashboard)/dashboard/page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

function status(failed: number) {
  return {
    completed: {},
    failed: {},
    in_progress: {},
    summary: { total_files: 3, completed_count: 3 - failed, failed_count: failed, total_chunks: 32 },
  };
}

function summary() {
  return { today_questions: 2, week_questions: 9, total_qdrant_points: 0, feedback_helpful: 4, feedback_negative: 0 };
}

beforeEach(() => {
  mockChatbots.mockResolvedValue({
    items: [
      { id: "1", chatbot_id: "all", display_name: "전체 검색", is_active: true, search_tiers: { tiers: [] } },
      { id: "2", chatbot_id: "b", display_name: "소스 B", is_active: false, search_tiers: { tiers: [] } },
    ],
    total: 2,
  });
  mockStatus.mockResolvedValue(status(0));
  mockSummary.mockResolvedValue(summary());
  mockFeedbackList.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("대시보드", () => {
  it("지표를 한 띠로 보이고 활성/전체 챗봇을 한 칸에 쓴다", async () => {
    renderPage();
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(await screen.findByText("청크 32 · 긍정 피드백 4")).toBeInTheDocument();
    expect(await screen.findByText("지금 확인할 항목이 없어요.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("불러오지 못한 지표를 0 으로 보이지 않고 다시 시도를 준다", async () => {
    mockStatus.mockRejectedValue(new Error("500"));
    mockSummary.mockRejectedValue(new Error("500"));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("일부 지표를 불러오지 못했습니다.");
    expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeInTheDocument();

    const band = screen.getByText("오늘 질문").closest("dl") as HTMLElement;
    expect(within(band).getAllByText("—")).toHaveLength(3);
    expect(within(band).queryByText("0")).not.toBeInTheDocument();
    // 처리 현황을 못 받았으면 "확인할 것 없음"이라고 단정하지 않는다.
    expect(screen.queryByText("지금 확인할 항목이 없어요.")).not.toBeInTheDocument();
    expect(screen.getByText("청크 — · 긍정 피드백 —")).toBeInTheDocument();
  });

  it("처리 실패와 최근 부정 피드백을 확인할 것에 올린다", async () => {
    mockStatus.mockResolvedValue(status(2));
    mockFeedbackList.mockResolvedValue([
      {
        id: "f1",
        session_id: "s1",
        question: "축복의 의미는?",
        answer_snippet: "",
        chatbot_name: "전체 검색",
        comment: null,
        created_at: "2026-10-05T05:02:00Z",
        feedback_type: "INACCURATE",
      },
    ]);
    renderPage();

    const todo = (await screen.findByRole("heading", { name: "확인할 것" })).closest("section") as HTMLElement;
    expect(await within(todo).findByRole("link", { name: /문서 2건을 처리하지 못했어요/ })).toHaveAttribute(
      "href",
      "/data-sources",
    );
    expect(within(todo).getByRole("button", { name: /축복의 의미는\?/ })).toBeInTheDocument();
    expect(within(todo).queryByText("지금 확인할 항목이 없어요.")).not.toBeInTheDocument();
    // 부정 피드백은 최근 7일 3건만 묻는다.
    expect(mockFeedbackList).toHaveBeenCalledWith("negative", 3, 0, 7);
  });
});
