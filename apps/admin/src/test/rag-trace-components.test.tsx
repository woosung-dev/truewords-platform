import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CandidateTable,
  DropStageBadge,
  normalizeDropStage,
  sortCandidates,
} from "@/features/rag-trace/components/candidate-table";
import { barGeometry, buildRows, StageWaterfall } from "@/features/rag-trace/components/stage-waterfall";
import { warningBadge } from "@/features/rag-trace/components/trace-summary";
import type { CandidateRow, StageSpan } from "@/features/rag-trace/types";

// TruncateTooltip 이 matchMedia 를 읽는다(jsdom 미구현).
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

afterEach(() => cleanup());

function span(overrides: Partial<StageSpan> & Pick<StageSpan, "name" | "start_ms" | "duration_ms">): StageSpan {
  return { kind: "stage", status: "ok", ...overrides };
}

function cand(overrides: Partial<CandidateRow>): CandidateRow {
  return {
    key: "v1:0",
    chunk_id: "c0",
    volume: "v1",
    source: "A",
    preview: "본문",
    origin: "hybrid",
    drop_stage: "kept",
    ...overrides,
  };
}

describe("barGeometry", () => {
  it("시작·지연을 전체 대비 비율(%)로 바꾼다", () => {
    expect(barGeometry(250, 500, 1000)).toEqual({ left: 25, width: 50 });
    expect(barGeometry(0, 1000, 1000)).toEqual({ left: 0, width: 100 });
  });

  it("아주 짧은 span 도 0.5% 폭으로 보이고 오른쪽 끝을 넘지 않는다", () => {
    expect(barGeometry(100, 0, 1000)).toEqual({ left: 10, width: 0.5 });
    expect(barGeometry(900, 500, 1000)).toEqual({ left: 90, width: 10 });
  });

  it("전체가 0 이면 막대를 그리지 않는다", () => {
    expect(barGeometry(0, 10, 0)).toEqual({ left: 0, width: 0 });
  });
});

describe("StageWaterfall", () => {
  it("막대 left/width 가 span 시간 비율과 같다", () => {
    render(
      <StageWaterfall
        spans={[
          span({ name: "embedding", start_ms: 0, duration_ms: 200 }),
          span({ name: "search", start_ms: 200, duration_ms: 600 }),
        ]}
        totalMs={800}
      />,
    );
    const bars = screen.getAllByTestId("waterfall-bar");
    expect(bars[0]).toHaveStyle({ left: "0%", width: "25%" });
    expect(bars[1]).toHaveStyle({ left: "25%", width: "75%" });
  });

  it("span 끝이 total_ms 보다 늦으면 그 끝을 전체 길이로 쓴다", () => {
    render(<StageWaterfall spans={[span({ name: "debug_lookup", start_ms: 500, duration_ms: 500 })]} totalMs={500} />);
    expect(screen.getByTestId("waterfall-bar")).toHaveStyle({ left: "50%", width: "50%" });
  });

  it("행을 누르면 input·output 표가 펼쳐진다", async () => {
    render(
      <StageWaterfall
        spans={[
          span({
            name: "query_rewrite",
            start_ms: 0,
            duration_ms: 10,
            input: { query: "축복" },
            output: { rewritten: true },
          }),
        ]}
        totalMs={10}
      />,
    );
    const row = screen.getByRole("button", { name: /query_rewrite/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const table = screen.getByRole("table");
    expect(within(table).getByText("축복")).toBeInTheDocument();
    expect(within(table).getByText("true")).toBeInTheDocument();
  });

  it("오류·시간 초과 상태를 배지로 보인다", () => {
    render(
      <StageWaterfall
        spans={[
          span({ name: "rerank", start_ms: 0, duration_ms: 10, status: "timeout" }),
          span({ name: "search", start_ms: 10, duration_ms: 10, status: "ERROR" as StageSpan["status"] }),
        ]}
        totalMs={20}
      />,
    );
    expect(screen.getByText("시간 초과")).toBeInTheDocument();
    expect(screen.getByText("오류")).toBeInTheDocument();
  });
});

describe("buildRows", () => {
  it("하위 호출은 parent 아래로 들여 쓰고 병렬 그룹은 한 행으로 묶는다", () => {
    const rows = buildRows([
      span({ name: "safety_output", start_ms: 50, duration_ms: 1 }),
      span({ name: "intent_classifier", start_ms: 0, duration_ms: 30 }),
      span({ name: "gemini.generate_text", start_ms: 1, duration_ms: 28, parent: "intent_classifier", kind: "llm" }),
      span({ name: "closing_template", start_ms: 60, duration_ms: 5, parallel_group: "postprocess" }),
      span({ name: "suggested_followups", start_ms: 60, duration_ms: 20, parallel_group: "postprocess" }),
    ]);
    expect(rows.map((r) => (r.type === "group" ? `group:${r.name}` : `${r.depth}:${r.span.name}`))).toEqual([
      "0:intent_classifier",
      "1:gemini.generate_text",
      "0:safety_output",
      "group:postprocess",
      "1:closing_template",
      "1:suggested_followups",
    ]);
  });
});

describe("DropStageBadge", () => {
  it.each([
    ["kept", "포함"],
    ["not_retrieved", "미검색"],
    ["filtered", "필터 제외"],
    ["fusion_cut", "융합 탈락"],
    ["below_threshold", "점수 미달"],
    ["tier_not_reached", "tier 미도달"],
    ["merge_cut", "병합 탈락"],
    ["rerank_cut", "rerank 탈락"],
    ["context_cut", "context 탈락"],
    ["RERANK_CUT", "rerank 탈락"],
  ])("%s → %s", (value, label) => {
    render(<DropStageBadge value={value} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("null 은 판정 보류로 보인다", () => {
    render(<DropStageBadge value={null} />);
    expect(screen.getByText("판정 보류")).toBeInTheDocument();
    expect(normalizeDropStage("unknown_stage")).toBeNull();
  });
});

describe("CandidateTable", () => {
  const rows = [
    cand({ key: "v1:0", chunk_id: "a", rrf_score: 0.2, drop_stage: "kept" }),
    cand({ key: "v1:1", chunk_id: "b", rrf_score: null, drop_stage: "not_retrieved" }),
    cand({ key: "v1:2", chunk_id: "c", rrf_score: 0.4, drop_stage: null }),
    cand({ key: "v1:0", chunk_id: "a", rrf_score: 0.2, drop_stage: "merge_cut", duplicate_of: "v1:0" }),
  ];

  it("숫자 열 정렬은 null 을 방향과 상관없이 맨 뒤에 둔다", () => {
    expect(sortCandidates(rows, "rrf_score", "asc").map((r) => r.rrf_score)).toEqual([0.2, 0.2, 0.4, null]);
    expect(sortCandidates(rows, "rrf_score", "desc").map((r) => r.rrf_score)).toEqual([0.4, 0.2, 0.2, null]);
  });

  it("탈락만 필터는 kept 와 판정 보류를 뺀다", async () => {
    render(<CandidateTable candidates={rows} />);
    expect(screen.getAllByTestId("candidate-row")).toHaveLength(4);
    await userEvent.click(screen.getByRole("checkbox", { name: "탈락만" }));
    const visible = screen.getAllByTestId("candidate-row");
    expect(visible).toHaveLength(2);
    expect(within(visible[0]).getByText("미검색")).toBeInTheDocument();
    expect(within(visible[1]).getByText("병합 탈락")).toBeInTheDocument();
  });

  it("열 머리를 누르면 정렬하고 다시 누르면 방향을 바꾼다", async () => {
    render(<CandidateTable candidates={rows} />);
    const header = screen.getByRole("button", { name: "RRF" });
    await userEvent.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(within(screen.getAllByTestId("candidate-row")[0]).getByText("0.4000")).toBeInTheDocument();
  });

  it("rerank 순위 변화(Δ)를 fused 순위 대비로 보인다", () => {
    render(<CandidateTable candidates={[cand({ fused_rank: 5, rerank_rank: 2 })]} />);
    expect(screen.getByText("(+3)")).toBeInTheDocument();
  });

  it("후보가 없으면 안내 문구를 보인다", () => {
    render(<CandidateTable candidates={[]} />);
    expect(screen.getByText("검색 후보가 없습니다")).toBeInTheDocument();
  });
});

describe("warningBadge", () => {
  it("코드:N 형식은 문구 뒤에 숫자를 붙인다", () => {
    expect(warningBadge("filter_loss:3")).toEqual({ label: "필터 손실 3", tone: "warning" });
    expect(warningBadge("duplicates:2").label).toBe("중복 2");
    expect(warningBadge("rerank_parse_fail").label).toBe("rerank 파싱 실패");
  });

  it("모르는 코드는 원문 그대로 보인다", () => {
    expect(warningBadge("something_new")).toEqual({ label: "something_new", tone: "neutral" });
  });
});
