import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SearchTierEditor from "@/components/search-tier-editor";
import type { SearchTier } from "@/lib/api";

// useSearchableCategories 훅 mock
vi.mock("@/lib/hooks/use-data-source-categories", () => ({
  useSearchableCategories: () => ({
    data: [
      { key: "A", name: "말씀선집", color: "indigo", is_searchable: true },
      { key: "B", name: "어머니말씀", color: "violet", is_searchable: true },
      { key: "C", name: "원리강론", color: "blue", is_searchable: true },
    ],
    isLoading: false,
  }),
}));

describe("SearchTierEditor", () => {
  // --- 빈 상태 ---

  it("빈 티어 배열일 때 빈 상태 메시지를 표시한다", () => {
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={[]} onChange={onChange} />);

    expect(screen.getByText("검색 티어가 없습니다. 티어를 추가해주세요.")).toBeInTheDocument();
    expect(screen.getByText("티어 추가")).toBeInTheDocument();
  });

  it("빈 상태에서 '티어 추가' 클릭 시 기본 티어를 추가한다", () => {
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={[]} onChange={onChange} />);

    fireEvent.click(screen.getByText("티어 추가"));

    expect(onChange).toHaveBeenCalledWith([
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ]);
  });

  // --- 티어 렌더링 ---

  it("티어 목록을 렌더링한다", () => {
    const tiers: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
      { sources: ["B", "C"], min_results: 2, score_threshold: 0.60 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={tiers} onChange={onChange} />);

    expect(screen.getByText("Tier 1")).toBeInTheDocument();
    expect(screen.getByText("최우선")).toBeInTheDocument();
    expect(screen.getByText("Tier 2")).toBeInTheDocument();
  });

  it("데이터 소스 버튼을 한글 이름으로 표시한다", () => {
    const tiers: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={tiers} onChange={onChange} />);

    // 한글 레이블로 표시
    expect(screen.getAllByText("말씀선집").length).toBeGreaterThan(0);
    expect(screen.getAllByText("어머니말씀").length).toBeGreaterThan(0);
    expect(screen.getAllByText("원리강론").length).toBeGreaterThan(0);
    expect(screen.getByText(/높을수록 정확한 결과만 표시/)).toBeInTheDocument();
    expect(screen.getByText(/이 티어에서 최소 몇 개가 나와야 통과/)).toBeInTheDocument();
  });

  // --- 티어 추가 ---

  it("기존 티어가 있을 때 '티어 추가'로 티어를 추가한다", () => {
    const existing: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={existing} onChange={onChange} />);

    const addButtons = screen.getAllByText("티어 추가");
    fireEvent.click(addButtons[addButtons.length - 1]);

    expect(onChange).toHaveBeenCalledWith([
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ]);
  });

  // --- 티어 삭제 ---

  it("삭제 버튼 클릭 시 해당 티어를 제거한다", () => {
    const tiers: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
      { sources: ["B"], min_results: 2, score_threshold: 0.60 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={tiers} onChange={onChange} />);

    const deleteButtons = screen.getAllByTitle("삭제");
    fireEvent.click(deleteButtons[0]);

    expect(onChange).toHaveBeenCalledWith([
      { sources: ["B"], min_results: 2, score_threshold: 0.60 },
    ]);
  });

  // --- 티어 순서 변경 ---

  it("아래로 이동 버튼 클릭 시 순서를 변경한다", () => {
    const tiers: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
      { sources: ["B"], min_results: 2, score_threshold: 0.60 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={tiers} onChange={onChange} />);

    const downButtons = screen.getAllByTitle("아래로 이동");
    fireEvent.click(downButtons[0]);

    expect(onChange).toHaveBeenCalledWith([
      { sources: ["B"], min_results: 2, score_threshold: 0.60 },
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ]);
  });

  it("첫 번째 티어의 위로 이동 버튼은 비활성화이다", () => {
    const tiers: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
      { sources: ["B"], min_results: 2, score_threshold: 0.60 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={tiers} onChange={onChange} />);

    const upButtons = screen.getAllByTitle("위로 이동");
    expect(upButtons[0]).toBeDisabled();
  });

  it("마지막 티어의 아래로 이동 버튼은 비활성화이다", () => {
    const tiers: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
      { sources: ["B"], min_results: 2, score_threshold: 0.60 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={tiers} onChange={onChange} />);

    const downButtons = screen.getAllByTitle("아래로 이동");
    expect(downButtons[1]).toBeDisabled();
  });

  // --- min_results 입력 ---

  it("min_results 값을 변경한다", () => {
    const tiers: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={tiers} onChange={onChange} />);

    const input = screen.getByLabelText(/최소 결과 수/);
    fireEvent.change(input, { target: { value: "5" } });

    expect(onChange).toHaveBeenCalledWith([
      { sources: ["A"], min_results: 5, score_threshold: 0.75 },
    ]);
  });

  it("min_results가 1 미만이면 1로 클램프한다", () => {
    const tiers: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={tiers} onChange={onChange} />);

    const input = screen.getByLabelText(/최소 결과 수/);
    fireEvent.change(input, { target: { value: "0" } });

    expect(onChange).toHaveBeenCalledWith([
      { sources: ["A"], min_results: 1, score_threshold: 0.75 },
    ]);
  });
});
