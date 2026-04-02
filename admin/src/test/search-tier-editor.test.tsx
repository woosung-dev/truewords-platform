import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SearchTierEditor from "@/components/search-tier-editor";
import type { SearchTier } from "@/lib/api";

describe("SearchTierEditor", () => {
  // --- 빈 상태 ---

  it("빈 티어 배열일 때 빈 상태 메시지를 표시한다", () => {
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={[]} onChange={onChange} />);

    expect(screen.getByText("검색 티어가 없습니다. 추가하세요.")).toBeInTheDocument();
    expect(screen.getByText("+ 티어 추가")).toBeInTheDocument();
  });

  it("빈 상태에서 '+ 티어 추가' 클릭 시 기본 티어를 추가한다", () => {
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={[]} onChange={onChange} />);

    fireEvent.click(screen.getByText("+ 티어 추가"));

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

    expect(screen.getByText("Tier 1 (최우선)")).toBeInTheDocument();
    expect(screen.getByText("Tier 2")).toBeInTheDocument();
  });

  it("도움말 텍스트를 표시한다", () => {
    const tiers: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={tiers} onChange={onChange} />);

    expect(screen.getByText("A: 말씀선집")).toBeInTheDocument();
    expect(screen.getByText("B: 어머니말씀")).toBeInTheDocument();
    expect(screen.getByText("C: 원리강론")).toBeInTheDocument();
    expect(screen.getByText(/높을수록 정확한 결과만 표시/)).toBeInTheDocument();
    expect(screen.getByText(/이 티어에서 최소 몇 개 결과를 찾아야 하는지/)).toBeInTheDocument();
  });

  // --- 티어 추가 ---

  it("기존 티어가 있을 때 '+ 티어 추가'로 티어를 추가한다", () => {
    const existing: SearchTier[] = [
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ];
    const onChange = vi.fn();
    render(<SearchTierEditor tiers={existing} onChange={onChange} />);

    fireEvent.click(screen.getByText("+ 티어 추가"));

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
