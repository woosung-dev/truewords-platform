import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueryDetail } from "@/features/analytics/types";

const mockGetQueryDetails = vi.fn();
vi.mock("@/features/analytics/api", () => ({
  analyticsAPI: {
    getQueryDetails: (...args: unknown[]) => mockGetQueryDetails(...args),
  },
}));

import QueryDetailModal from "@/features/analytics/components/query-detail-modal";

function renderModal(props: Partial<React.ComponentProps<typeof QueryDetailModal>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QueryDetailModal
        open={true}
        onOpenChange={() => {}}
        queryText="천일국"
        days={30}
        {...props}
      />
    </QueryClientProvider>
  );
}

function occurrenceFixture(
  overrides: Partial<QueryDetail["occurrences"][number]> = {}
): QueryDetail["occurrences"][number] {
  return {
    search_event_id: "11111111-1111-1111-1111-111111111111",
    user_message_id: "22222222-2222-2222-2222-222222222222",
    assistant_message_id: "33333333-3333-3333-3333-333333333333",
    session_id: "44444444-4444-4444-4444-444444444444",
    chatbot_id: "55555555-5555-5555-5555-555555555555",
    chatbot_name: "기본 챗봇",
    asked_at: "2026-04-21T10:00:00",
    rewritten_query: null,
    search_tier: 0,
    total_results: 3,
    latency_ms: 200,
    applied_filters: {},
    answer_text: "천일국이란...",
    citations: [
      {
        source: "A",
        volume: 1,
        chapter: "제3장",
        text_snippet: "원문 스니펫",
        relevance_score: 0.87,
        rank_position: 0,
      },
    ],
    feedback: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockGetQueryDetails.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("QueryDetailModal", () => {
  it("로딩 중엔 스켈레톤을 렌더한다", () => {
    mockGetQueryDetails.mockReturnValue(new Promise(() => {})); // pending
    renderModal();
    // Dialog.Portal은 document.body에 마운트되므로 body 전체에서 검색
    expect(document.body.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
  });

  it("occurrences가 0건이면 안내 문구를 노출한다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 0,
      returned_count: 0,
      days: 30,
      occurrences: [],
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText(/발생이 없습니다/)).toBeDefined();
  });

  it("첫 번째 발생은 기본으로 펼쳐져 답변과 출처를 보여준다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 1,
      returned_count: 1,
      days: 30,
      occurrences: [occurrenceFixture()],
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText("천일국이란...")).toBeDefined();
    expect(screen.getByText(/매칭 출처/)).toBeDefined();
    expect(screen.getByText("원문 스니펫")).toBeDefined();
  });

  it("답변이 없는 발생은 '답변이 저장되지 않았습니다' 플레이스홀더를 보여준다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 1,
      returned_count: 1,
      days: 30,
      occurrences: [
        occurrenceFixture({
          assistant_message_id: null,
          answer_text: null,
          citations: [],
        }),
      ],
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText(/답변이 저장되지 않았습니다/)).toBeDefined();
    expect(screen.getByText(/매칭된 출처가 없습니다/)).toBeDefined();
  });

  it("봇이 삭제된 발생은 '(삭제된 봇)' 라벨을 보여준다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 1,
      returned_count: 1,
      days: 30,
      occurrences: [occurrenceFixture({ chatbot_name: null })],
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText("(삭제된 봇)")).toBeDefined();
  });

  it("total_count > returned_count 일 때 상위 N건 표시 문구가 노출된다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 120,
      returned_count: 50,
      days: 30,
      occurrences: Array.from({ length: 50 }, (_, i) =>
        occurrenceFixture({
          search_event_id: `event-${i}`,
        })
      ),
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText(/상위 50건만 표시/)).toBeDefined();
  });

  it("두 번째 발생 헤더를 클릭하면 본문이 펼쳐진다", async () => {
    const user = userEvent.setup();
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 2,
      returned_count: 2,
      days: 30,
      occurrences: [
        occurrenceFixture({
          search_event_id: "a",
          answer_text: "첫 번째 답",
        }),
        occurrenceFixture({
          search_event_id: "b",
          answer_text: "두 번째 답",
        }),
      ],
    } satisfies QueryDetail);

    renderModal();
    await screen.findByText("첫 번째 답"); // #1 펼침 확인
    expect(screen.queryByText("두 번째 답")).toBeNull();

    const headers = screen.getAllByRole("button", { expanded: false });
    // 첫 번째 false-expanded 버튼 = 두 번째 발생 헤더
    await user.click(headers[0]);
    expect(await screen.findByText("두 번째 답")).toBeDefined();
  });
});
