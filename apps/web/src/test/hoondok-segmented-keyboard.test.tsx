import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { WeekStrip } from "@/components/hoondok/week-strip";
import { handleSegmentKeyDown } from "@/features/hoondok/segmented-keyboard";

function Segments() {
  const [selected, setSelected] = useState(0);
  return (
    <div role="tablist" aria-label="보기" onKeyDown={handleSegmentKeyDown}>
      {["전체", "준비 중", "저장"].map((name, index) => (
        <button
          key={name}
          type="button"
          role="tab"
          disabled={index === 1}
          aria-selected={selected === index}
          tabIndex={selected === index ? 0 : -1}
          onClick={() => setSelected(index)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

describe("훈독 비시각 조작", () => {
  it("방향키는 비활성 탭을 건너뛰고 선택과 포커스를 함께 이동한다", () => {
    render(<Segments />);
    const first = screen.getByRole("tab", { name: "전체" });
    const last = screen.getByRole("tab", { name: "저장" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(first).toHaveFocus();
  });
  it("주간 완료를 요일과 함께 접근성 이름으로 알린다", () => {
    render(<WeekStrip todayWeekday={2} doneByDay={[true, false]} />);
    expect(screen.getByLabelText("월요일 · 훈독 완료")).toHaveAttribute("data-done");
    expect(screen.getByLabelText("화요일")).toHaveAttribute("aria-current", "date");
  });
});
