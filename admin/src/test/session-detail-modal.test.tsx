import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SessionDetail } from "@/features/analytics/types";

const mockGetSessionDetail = vi.fn();
vi.mock("@/features/analytics/api", () => ({
  analyticsAPI: {
    getSessionDetail: (...args: unknown[]) => mockGetSessionDetail(...args),
  },
}));

import SessionDetailModal from "@/features/analytics/components/session-detail-modal";

function renderModal(
  props: Partial<React.ComponentProps<typeof SessionDetailModal>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionDetailModal
        open={true}
        onOpenChange={() => {}}
        sessionId="44444444-4444-4444-4444-444444444444"
        {...props}
      />
    </QueryClientProvider>
  );
}

function detailFixture(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    session_id: "44444444-4444-4444-4444-444444444444",
    chatbot_id: "55555555-5555-5555-5555-555555555555",
    chatbot_name: "축복AI",
    started_at: "2026-05-03T09:00:00",
    ended_at: null,
    messages: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        role: "user",
        content: "축복 절차에 대해서 알려줘",
        created_at: "2026-05-03T09:06:00",
        resolved_answer_mode: null,
        persona_overridden: null,
        reactions: [],
        feedback: null,
        citations: [],
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        role: "assistant",
        content: "축복 절차는 다음과 같습니다",
        created_at: "2026-05-03T09:06:05",
        resolved_answer_mode: "default",
        persona_overridden: false,
        reactions: [{ kind: "thumbs_down", count: 1 }],
        feedback: {
          feedback_type: "inaccurate",
          comment: "정확하지 않음",
          created_at: "2026-05-03T09:07:00",
        },
        citations: [
          {
            source: "B",
            volume: 5,
            chapter: null,
            text_snippet: "참어머님 말씀...",
            relevance_score: 0.5,
            rank_position: 1,
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mockGetSessionDetail.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SessionDetailModal", () => {
  it("로딩 중엔 스켈레톤을 렌더한다", () => {
    mockGetSessionDetail.mockReturnValue(new Promise(() => {}));
    renderModal();
    expect(
      document.body.querySelectorAll(
        '[data-slot="skeleton"], .animate-pulse'
      ).length
    ).toBeGreaterThan(0);
  });

  it("user 메시지와 assistant 메시지를 시간순으로 렌더한다", async () => {
    mockGetSessionDetail.mockResolvedValue(detailFixture());
    renderModal();
    expect(await screen.findByText("축복 절차에 대해서 알려줘")).toBeDefined();
    expect(screen.getByText("축복 절차는 다음과 같습니다")).toBeDefined();
    expect(screen.getByText(/사용자/)).toBeDefined();
    expect(screen.getByText(/챗봇/)).toBeDefined();
  });

  it("부정 피드백이 있으면 코멘트와 라벨을 inline 으로 보여준다", async () => {
    mockGetSessionDetail.mockResolvedValue(detailFixture());
    renderModal();
    expect(await screen.findByText("부정확")).toBeDefined();
    expect(screen.getByText(/정확하지 않음/)).toBeDefined();
  });

  it("메시지가 없으면 안내 문구를 노출한다", async () => {
    mockGetSessionDetail.mockResolvedValue(
      detailFixture({ messages: [] })
    );
    renderModal();
    expect(await screen.findByText(/메시지가 없습니다/)).toBeDefined();
  });

  it("헤더에 봇 이름과 메시지 수가 표시된다", async () => {
    mockGetSessionDetail.mockResolvedValue(detailFixture());
    renderModal();
    expect(await screen.findByText(/축복AI/)).toBeDefined();
    expect(screen.getByText(/메시지 2건/)).toBeDefined();
  });

  it("feedback 가 있는 메시지로 자동 스크롤한다", async () => {
    const scrollSpy = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    mockGetSessionDetail.mockResolvedValue(detailFixture());
    renderModal();
    await screen.findByText("축복 절차는 다음과 같습니다");
    // useEffect 의 setTimeout(50) 이후
    await new Promise((r) => setTimeout(r, 100));
    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    scrollSpy.mockRestore();
  });
});
