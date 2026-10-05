import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RagTraceResponse } from "@/features/rag-trace/types";
import { ApiError } from "@/lib/api";

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

const mockRun = vi.fn();
vi.mock("@/features/rag-trace/api", () => ({
  ragTraceAPI: { run: (...args: unknown[]) => mockRun(...args) },
}));

const mockList = vi.fn();
vi.mock("@/features/chatbot/api", () => ({
  chatbotAPI: { list: (...args: unknown[]) => mockList(...args) },
}));

import RagTracePage from "@/app/(dashboard)/rag-trace/page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RagTracePage />
    </QueryClientProvider>,
  );
}

function trace(overrides: Partial<RagTraceResponse> = {}): RagTraceResponse {
  return {
    intent: "conceptual",
    resolved_answer_mode: "standard",
    search_query: "축복의 의미",
    rewritten: false,
    fallback_type: "none",
    spans: [
      { name: "search", kind: "stage", status: "ok", start_ms: 0, duration_ms: 300 },
      {
        name: "generation",
        kind: "llm",
        status: "ok",
        start_ms: 300,
        duration_ms: 700,
        ttft_ms: 450,
        output: { context_n: 6 },
      },
    ],
    candidates: [
      {
        key: "말씀선집 1:3",
        chunk_id: "c1",
        volume: "말씀선집 1",
        source: "A",
        preview: "후보 본문",
        origin: "hybrid",
        rrf_score: 0.25,
        drop_stage: "kept",
      },
    ],
    generation: { system_prompt: "SYS", context_prompt: "CTX", answer: "답변 본문", history_window: [] },
    totals: { total_ms: 1000, critical_path_ms: 980, llm_calls: 2, input_tokens: 1200, output_tokens: 300 },
    warnings: [],
    partial: false,
    ...overrides,
  };
}

async function submit(query = "축복이란?") {
  await userEvent.type(screen.getByLabelText("질문"), query);
  await userEvent.click(screen.getByRole("button", { name: "실행" }));
}

beforeEach(() => {
  mockRun.mockReset();
  mockList.mockReset();
  mockList.mockResolvedValue({
    items: [
      { chatbot_id: "all", display_name: "전체" },
      { chatbot_id: "malssum", display_name: "말씀" },
    ],
    total: 2,
    limit: 100,
    offset: 0,
  });
});

afterEach(() => cleanup());

describe("RagTracePage", () => {
  it("첫 봇과 기본값으로 요청하고 체크하지 않은 override 는 null 로 보낸다", async () => {
    mockRun.mockResolvedValue(trace());
    renderPage();
    await screen.findByRole("option", { name: "전체 (all)" });
    await submit("  축복이란?  ");
    expect(mockRun).toHaveBeenCalledWith({
      query: "축복이란?",
      chatbot_id: "all",
      answer_mode: null,
      overrides: { rerank_enabled: null, query_rewrite_enabled: null },
      stop_after: "full",
    });
    expect(mockList).toHaveBeenCalledWith(100);
  });

  it("rerank 강제와 실행 범위를 요청에 싣는다", async () => {
    mockRun.mockResolvedValue(trace({ generation: null }));
    renderPage();
    await screen.findByRole("option", { name: "말씀 (malssum)" });
    await userEvent.selectOptions(screen.getByLabelText("챗봇"), "malssum");
    await userEvent.selectOptions(screen.getByLabelText("실행 범위"), "search");
    await userEvent.click(screen.getByRole("checkbox", { name: "rerank 강제 켜기" }));
    await submit();
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        chatbot_id: "malssum",
        stop_after: "search",
        overrides: { rerank_enabled: true, query_rewrite_enabled: null },
      }),
    );
    expect(await screen.findByText(/생성 단계를 실행하지 않았습니다/)).toBeInTheDocument();
  });

  it("질문이 비어 있으면 실행할 수 없다", async () => {
    renderPage();
    await screen.findByRole("option", { name: "전체 (all)" });
    expect(screen.getByRole("button", { name: "실행" })).toBeDisabled();
  });

  it("결과의 요약·워터폴·후보 표·생성 패널을 보인다", async () => {
    mockRun.mockResolvedValue(trace());
    renderPage();
    await screen.findByRole("option", { name: "전체 (all)" });
    await submit();
    expect(await screen.findByText("1.00s")).toBeInTheDocument(); // 총 지연
    expect(screen.getByText("450ms")).toBeInTheDocument(); // TTFT
    expect(screen.getByText("2회 · 1,200/300")).toBeInTheDocument();
    expect(screen.getByText(/현재 설정으로 다시 실행한 결과이며/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "단계별 워터폴" })).toBeInTheDocument();
    expect(screen.getByText("말씀선집 1:3")).toBeInTheDocument();
    expect(screen.getByText("답변 본문")).toBeInTheDocument();
  });

  it("429 는 동시 실행 안내를 보인다", async () => {
    mockRun.mockRejectedValue(new ApiError(429, { message: "busy" }));
    renderPage();
    await screen.findByRole("option", { name: "전체 (all)" });
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 2건 실행 중입니다");
  });

  it("서버 오류는 요청 ID 와 함께 재시도 안내를 보인다", async () => {
    mockRun.mockRejectedValue(new ApiError(500, { message: "boom", request_id: "req-1" }));
    renderPage();
    await screen.findByRole("option", { name: "전체 (all)" });
    await submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("서버 오류로 실행하지 못했습니다");
    expect(alert).toHaveTextContent("req-1");
  });

  it("네트워크 오류는 연결 안내를 보인다", async () => {
    mockRun.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage();
    await screen.findByRole("option", { name: "전체 (all)" });
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("서버에 연결할 수 없습니다");
  });

  it("partial 이면 일부 수집 안내와 경고 배지를 보인다", async () => {
    mockRun.mockResolvedValue(
      trace({
        partial: true,
        warnings: ["budget_exceeded", "candidates_incomplete", "filter_loss:2"],
        spans: [{ name: "rerank", kind: "stage", status: "timeout", start_ms: 0, duration_ms: 25000 }],
        candidates: [
          {
            key: "v:1",
            chunk_id: "c1",
            volume: "v",
            source: "A",
            preview: "",
            origin: "hybrid",
            drop_stage: null,
          },
        ],
        generation: null,
      }),
    );
    renderPage();
    await screen.findByRole("option", { name: "전체 (all)" });
    await submit();
    expect(await screen.findByText(/일부만 수집했습니다/)).toBeInTheDocument();
    const warnings = screen.getByRole("list", { name: "경고" });
    expect(warnings).toHaveTextContent("일부만 수집됨");
    expect(warnings).toHaveTextContent("예산 초과");
    expect(warnings).toHaveTextContent("후보 판정 보류");
    expect(warnings).toHaveTextContent("필터 손실 2");
    expect(screen.getByText("판정 보류")).toBeInTheDocument();
    expect(screen.getByText("시간 초과")).toBeInTheDocument();
  });

  it("실행 중에는 버튼이 잠기고 경과 초를 보인다", async () => {
    let resolve: (v: RagTraceResponse) => void = () => {};
    mockRun.mockReturnValue(new Promise<RagTraceResponse>((r) => (resolve = r)));
    renderPage();
    await screen.findByRole("option", { name: "전체 (all)" });
    await submit();
    expect(await screen.findByRole("button", { name: "실행 중..." })).toBeDisabled();
    expect(screen.getByText(/초 경과/)).toBeInTheDocument();
    resolve(trace());
    await waitFor(() => expect(screen.getByRole("button", { name: "실행" })).toBeEnabled());
  });
});
