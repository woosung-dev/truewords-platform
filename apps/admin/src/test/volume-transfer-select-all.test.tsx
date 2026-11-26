// 문서 이동 패널의 '전체 선택'이 화면에 보이는 검색 결과와 같은 항목을 고르는지 확인한다.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import VolumeTransfer from "@/features/data-source/components/volume-transfer";
import type { VolumeInfo } from "@/features/data-source/types";

const VOLUMES = [
  { volume: "참어머님 말씀 1권", chunk_count: 10, sources: [] },
  { volume: "참어머님 말씀 2권", chunk_count: 12, sources: [] },
  { volume: "천성경", chunk_count: 30, sources: [] },
] as unknown as VolumeInfo[];

function renderTransfer() {
  const onMove = vi.fn();
  render(
    <VolumeTransfer allVolumes={VOLUMES} includedVolumes={new Set()} onMove={onMove} categoryMap={new Map()} />,
  );
  // 데스크톱 3열 그리드는 CSS로만 숨기므로 jsdom에서는 첫 패널이 데스크톱 패널이다.
  const panel = screen.getAllByText("전체 문서")[0].closest("div.border") as HTMLElement;
  return { onMove, panel };
}

describe("VolumeTransfer 전체 선택", () => {
  it("검색어 앞뒤 공백을 무시하고 화면에 보이는 항목만 선택한다", () => {
    const { onMove, panel } = renderTransfer();

    fireEvent.change(within(panel).getByPlaceholderText("문서명 검색..."), { target: { value: "1권 " } });
    expect(within(panel).queryByText("천성경")).toBeNull();

    fireEvent.click(within(panel).getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByTitle("선택 항목 추가"));

    expect(onMove).toHaveBeenCalledWith(["참어머님 말씀 1권"], "add");
  });

  it("자모가 분리된(NFD) 검색어도 화면 목록과 같은 항목을 선택한다", () => {
    const { onMove, panel } = renderTransfer();

    fireEvent.change(within(panel).getByPlaceholderText("문서명 검색..."), {
      target: { value: "천성경".normalize("NFD") },
    });

    fireEvent.click(within(panel).getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByTitle("선택 항목 추가"));

    expect(onMove).toHaveBeenCalledWith(["천성경"], "add");
  });
});
