import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  stats: vi.fn(),
  trend: vi.fn(),
  modes: vi.fn(),
  top: vi.fn(),
  feedbackSummary: vi.fn(),
  feedbackList: vi.fn(),
  fetchAPI: vi.fn(),
}));

vi.mock("@/features/analytics/api", () => ({
  analyticsAPI: {
    getDashboardSummary: mocks.summary,
    getSearchStats: mocks.stats,
    getDailyTrend: mocks.trend,
    getDailyModes: mocks.modes,
    getTopQueries: mocks.top,
    getFeedbackSummary: mocks.feedbackSummary,
    getFeedbackList: mocks.feedbackList,
  },
}));
vi.mock("@/features/chatbot/api", () => ({
  chatbotAPI: { list: vi.fn().mockResolvedValue({ total: 0, items: [] }) },
}));
vi.mock("@/features/data-source/api", () => ({
  dataAPI: { getStatus: vi.fn().mockResolvedValue({ summary: { total_chunks: 0, failed_count: 0 } }) },
}));
vi.mock("@/features/auth/api", () => ({
  authAPI: { me: vi.fn().mockResolvedValue({ user_id: "self", email: "self@example.com" }) },
}));
vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
  fetchAPI: mocks.fetchAPI,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/features/analytics/components/session-detail-modal", () => ({ default: () => null }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: () => null,
  PieChart: () => null,
  Bar: () => null,
  Cell: () => null,
  Legend: () => null,
  Pie: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import AnalyticsPage from "@/app/(dashboard)/analytics/page";
import AuditLogsPage from "@/app/(dashboard)/audit-logs/page";
import DashboardPage from "@/app/(dashboard)/dashboard/page";
import FeedbackPage from "@/app/(dashboard)/feedback/page";
import SettingsPage from "@/app/(dashboard)/settings/page";

const SUMMARY = { today_questions: 17, week_questions: 37, feedback_helpful: 4, feedback_negative: 2 };
const STATS = {
  total_searches: 37,
  rewrite_rate: 0.2,
  zero_result_rate: 0.1,
  avg_latency_ms: 200,
  fallback_none: 30,
  fallback_relaxed: 5,
  fallback_suggestions: 2,
};
const LOG = {
  id: "log-1",
  action: "update",
  target_table: "chatbot_config",
  created_at: "2026-10-30T00:00:00Z",
  changes: { description: "변경한 내용을 생략 없이 확인합니다. ".repeat(12) },
};

function renderPage(Page: ComponentType, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.summary.mockResolvedValue(SUMMARY);
  mocks.stats.mockResolvedValue(STATS);
  mocks.trend.mockResolvedValue([]);
  mocks.modes.mockResolvedValue([]);
  mocks.top.mockResolvedValue([]);
  mocks.feedbackSummary.mockResolvedValue({ distribution: [] });
  mocks.feedbackList.mockResolvedValue([]);
  mocks.fetchAPI.mockResolvedValue([]);
});
afterEach(cleanup);

describe("관리자 조회 실패와 복구", () => {
  it.each([
    {
      name: "대시보드",
      Page: DashboardPage,
      fail: () => mocks.summary.mockRejectedValue(new Error("503")),
      recover: () => mocks.summary.mockResolvedValue(SUMMARY),
      missing: "시스템 요약을 불러오지 못했습니다.",
      restored: "17",
      empty: "",
    },
    {
      name: "검색 분석",
      Page: AnalyticsPage,
      fail: () =>
        [mocks.stats, mocks.trend, mocks.modes, mocks.top].forEach((fn) => fn.mockRejectedValue(new Error("503"))),
      recover: () => {
        mocks.stats.mockResolvedValue(STATS);
        [mocks.trend, mocks.modes, mocks.top].forEach((fn) => fn.mockResolvedValue([]));
      },
      missing: "검색 통계를 불러오지 못했습니다.",
      restored: "37",
      empty: "데이터가 없습니다",
    },
    {
      name: "감사 로그",
      Page: AuditLogsPage,
      fail: () => mocks.fetchAPI.mockRejectedValue(new Error("503")),
      recover: () => mocks.fetchAPI.mockResolvedValue([LOG]),
      missing: "감사 로그를 불러오지 못했습니다.",
      restored: "chatbot_config",
      empty: "감사 로그가 없습니다",
    },
    {
      name: "피드백",
      Page: FeedbackPage,
      fail: () => [mocks.feedbackSummary, mocks.feedbackList].forEach((fn) => fn.mockRejectedValue(new Error("503"))),
      recover: () => {
        mocks.feedbackSummary.mockResolvedValue({ distribution: [] });
        mocks.feedbackList.mockResolvedValue([
          {
            id: "feedback-1",
            session_id: "s1",
            created_at: "2026-10-30T00:00:00Z",
            question: "감사를 실천하려면?",
            answer_snippet: "먼저 인사해 보세요",
            feedback_type: "helpful",
          },
        ]);
      },
      missing: "피드백 목록을 불러오지 못했습니다.",
      restored: "감사를 실천하려면?",
      empty: "피드백이 없습니다",
    },
    {
      name: "설정",
      Page: SettingsPage,
      fail: () => mocks.fetchAPI.mockRejectedValue(new Error("503")),
      recover: () =>
        mocks.fetchAPI.mockResolvedValue([
          {
            id: "other",
            email: "recovered@example.com",
            role: "ADMIN",
            is_active: true,
            created_at: "2026-10-30T00:00:00Z",
          },
        ]),
      missing: "관리자 계정 목록을 불러오지 못했습니다.",
      restored: "recovered@example.com",
      empty: "등록된 관리자가 없습니다",
    },
  ])(
    "$name: 실패를 빈 데이터로 표시하지 않고 재시도 후 복구한다",
    async ({ Page, fail, recover, missing, restored, empty }) => {
      fail();
      renderPage(Page);
      expect(await screen.findByText(missing)).toBeInTheDocument();
      if (empty) expect(screen.queryByText(empty)).not.toBeInTheDocument();
      recover();
      const user = userEvent.setup();
      for (const button of screen.getAllByRole("button", { name: "다시 시도" })) await user.click(button);
      expect(await screen.findByText(restored)).toBeInTheDocument();
      expect(screen.queryByText(missing)).not.toBeInTheDocument();
    },
  );

  it("대시보드 재조회 실패는 이전 값을 유지하며 최신 정보가 아님을 알린다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["dashboard-summary"], SUMMARY);
    mocks.summary.mockRejectedValue(new Error("503"));
    renderPage(DashboardPage, client);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["dashboard-summary"] });
    });
    expect(await screen.findByText("이전에 불러온 정보를 표시하고 있습니다.")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
  });

  it("감사 로그 0건은 1–0건 대신 0건으로 표시한다", async () => {
    renderPage(AuditLogsPage);
    expect(await screen.findByText("감사 로그가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("0건")).toBeInTheDocument();
    expect(screen.queryByText("1–0건")).not.toBeInTheDocument();
  });

  it("감사 로그의 긴 변경 내용을 펼쳐 끝까지 읽을 수 있다", async () => {
    mocks.fetchAPI.mockResolvedValue([LOG]);
    renderPage(AuditLogsPage);
    const disclosure = await screen.findByText("변경 내용 보기");
    await userEvent.setup().click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("전체 변경 내용").textContent).toBe(JSON.stringify(LOG.changes, null, 2));
  });
});
