import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatbotConfig } from "@/features/chatbot/types";

const mockList = vi.fn();
vi.mock("@/features/chatbot/api", async () => ({
  ...(await vi.importActual<typeof import("@/features/chatbot/api")>("@/features/chatbot/api")),
  chatbotAPI: { list: (...args: unknown[]) => mockList(...args) },
}));
vi.mock("@/features/data-source/api", async () => ({
  ...(await vi.importActual<typeof import("@/features/data-source/api")>("@/features/data-source/api")),
  dataAPI: { getStatus: vi.fn().mockResolvedValue({ summary: { total_chunks: 0, failed_count: 0 } }) },
}));
vi.mock("@/features/analytics/api", () => ({
  analyticsAPI: { getDashboardSummary: vi.fn().mockResolvedValue({}) },
}));

import ChatbotsPage from "@/app/(dashboard)/chatbots/page";
import DashboardPage from "@/app/(dashboard)/dashboard/page";

afterEach(cleanup);

function bot(name: string): ChatbotConfig {
  return { id: name, chatbot_id: name, display_name: name, is_active: true } as ChatbotConfig;
}

describe("챗봇 목록 쿼리 키", () => {
  it("대시보드(100,0)가 채운 캐시를 챗봇 목록(20,0)이 자기 데이터로 쓰지 않는다", async () => {
    // 대시보드는 100건 응답, 목록 화면(20건)은 끝나지 않게 둬 캐시 재사용 여부만 본다.
    mockList.mockImplementation((limit: number) =>
      limit === 100 ? Promise.resolve({ total: 777, items: [bot("dashboard-only-bot")] }) : new Promise(() => {}),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (ui: ReactNode) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;

    const dashboard = render(wrap(<DashboardPage />));
    await waitFor(() => expect(screen.getByText("777")).toBeInTheDocument());
    dashboard.unmount();

    render(wrap(<ChatbotsPage />));

    expect(mockList).toHaveBeenCalledWith(20, 0);
    expect(screen.queryByText("dashboard-only-bot")).not.toBeInTheDocument();
    expect(screen.queryByText("총 777개")).not.toBeInTheDocument();
  });
});
