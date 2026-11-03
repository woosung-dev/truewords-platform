import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SummaryCarousel } from "./carousel";

describe("요약 이미지 캐러셀", () => {
  it("키보드와 버튼으로 이동하고 마지막 이미지에서 다음 이동을 막는다", () => {
    render(<SummaryCarousel slides={[{ asset_id: "first", url: "/one.png", alt: "첫 개념", caption: "첫 설명" }, { asset_id: "second", url: "/two.png", alt: "두 번째 개념", caption: "두 번째 설명" }]} />);
    const track = screen.getByLabelText("이미지 슬라이드. 좌우 방향키로 이동");
    const scrollTo = vi.fn();
    track.scrollTo = scrollTo;
    Object.defineProperty(track, "clientWidth", { value: 300 });
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    expect(screen.getByRole("button", { name: "이전 이미지" })).toBeDisabled();
    fireEvent.keyDown(track, { key: "End" });
    expect(scrollTo).toHaveBeenCalledWith({ left: 300, behavior: "instant" });
    Object.defineProperty(track, "scrollLeft", { value: 300, configurable: true });
    fireEvent.scroll(track);
    expect(screen.getByText("두 번째 설명", { selector: ".sum-caption" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "다음 이미지" })).toBeDisabled();
    fireEvent.keyDown(track, { key: "Home" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "instant" });
  });
  it("공개본 교체로 이미지 수가 줄어도 유효한 이미지를 표시한다", () => {
    const first = { asset_id: "first", url: "/one.png", alt: "첫 개념", caption: "첫 설명" };
    const second = { asset_id: "second", url: "/two.png", alt: "두 번째 개념", caption: "두 번째 설명" };
    const { rerender } = render(<SummaryCarousel slides={[first, second]} />);
    const track = screen.getByLabelText("이미지 슬라이드. 좌우 방향키로 이동");
    Object.defineProperty(track, "clientWidth", { value: 300 });
    Object.defineProperty(track, "scrollLeft", { value: 300 });
    fireEvent.scroll(track);
    rerender(<SummaryCarousel slides={[first]} />);
    expect(screen.getByText("첫 설명", { selector: ".sum-caption" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "다음 이미지" })).toBeDisabled();
  });

});
