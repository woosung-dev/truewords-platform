import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatbotConfig } from "@/features/chatbot/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/features/data-source/hooks", () => ({
  useSearchableCategories: () => ({
    data: [{ key: "A", name: "말씀선집", color: "indigo", is_searchable: true }],
    isLoading: false,
  }),
}));

const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/features/chatbot/api", () => ({
  chatbotAPI: {
    get: (...args: unknown[]) => mockGet(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

import EditChatbotPage from "@/app/(dashboard)/chatbots/[id]/edit/page";

function config(searchTiers: ChatbotConfig["search_tiers"]): ChatbotConfig {
  return {
    id: "cfg-1",
    chatbot_id: "all",
    display_name: "전체 검색",
    description: "",
    system_prompt: "",
    persona_name: "",
    search_tiers: searchTiers,
    is_active: true,
    streaming_enabled: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

// React use() 가 기다리지 않고 바로 읽도록 이미 풀린 Promise 로 표시한다.
function resolvedParams(id: string): Promise<{ id: string }> {
  return Object.assign(Promise.resolve({ id }), { status: "fulfilled", value: { id } });
}

async function renderAndSave() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <EditChatbotPage params={resolvedParams("cfg-1")} />
      </Suspense>
    </QueryClientProvider>,
  );
  await screen.findByLabelText(/표시 이름/);
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  return mockUpdate.mock.calls[0][1] as { search_tiers: Record<string, unknown> };
}

describe("챗봇 수정 화면", () => {
  it("손대지 않고 저장하면 서버가 보낸 rerank·rewrite 값을 그대로 돌려보낸다", async () => {
    mockGet.mockReset().mockResolvedValue(
      config({
        search_mode: "cascading",
        tiers: [{ sources: ["A"], min_results: 3, score_threshold: 0.1 }],
        weighted_sources: [],
        rerank_enabled: true,
        dictionary_enabled: false,
        query_rewrite_enabled: false,
        multiturn_enabled: true,
        raw_rag_only: false,
      }),
    );
    mockUpdate.mockReset().mockResolvedValue({});

    const body = await renderAndSave();

    expect(screen.getByRole("checkbox", { name: /Rerank/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Query Rewriting/ })).not.toBeChecked();
    expect(body.search_tiers).toMatchObject({ rerank_enabled: true, query_rewrite_enabled: false });
  });

  it("저장된 rerank OFF 도 그대로 보여 주고 보낸다", async () => {
    mockGet.mockReset().mockResolvedValue(config({ tiers: [], rerank_enabled: false, query_rewrite_enabled: true }));
    mockUpdate.mockReset().mockResolvedValue({});

    const body = await renderAndSave();

    expect(screen.getByRole("checkbox", { name: /Rerank/ })).not.toBeChecked();
    expect(body.search_tiers).toMatchObject({ rerank_enabled: false, query_rewrite_enabled: true });
  });
});
