// 홈 "오늘의 하늘": 시간대는 KST 로 고르고, 이번 주 별자리 선은 연속으로 이어진 날끼리만 잇는다.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeekConstellation } from "@/components/hoondok";
import { SKY_OWL } from "@/features/hoondok/components/home-sky";
import { constellationLinks, msUntilNextSlot, skySlotAt } from "@/features/hoondok/sky";

/** KST 시각 → Date */
const kst = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00+09:00`);

describe("skySlotAt (KST 시간대)", () => {
  it.each([
    ["03:59", "night"],
    ["04:00", "dawn"],
    ["06:59", "dawn"],
    ["07:00", "day"],
    ["16:59", "day"],
    ["17:00", "dusk"],
    ["19:59", "dusk"],
    ["20:00", "night"],
    ["00:00", "night"],
  ] as const)("KST %s 는 %s", (time, slot) => {
    expect(skySlotAt(kst(time))).toBe(slot);
  });

  it("기기 시간대와 무관하게 KST 로 고른다 — UTC 22:30 은 KST 다음날 07:30 낮이다", () => {
    expect(skySlotAt(new Date("2026-11-08T22:30:00Z"))).toBe("day");
  });

  it("다음 경계까지 남은 시간을 KST 기준으로 센다(밤 → 다음날 새벽 4시 포함)", () => {
    expect(msUntilNextSlot(kst("06:30"))).toBe(30 * 60_000);
    expect(msUntilNextSlot(kst("16:00"))).toBe(60 * 60_000);
    expect(msUntilNextSlot(kst("22:00"))).toBe(6 * 3_600_000);
    expect(msUntilNextSlot(kst("01:00"))).toBe(3 * 3_600_000);
  });

  it("시간대별 부엉이는 시각으로만 정해진다", () => {
    expect(SKY_OWL).toEqual({ dawn: "welcome", day: "cheer", dusk: "rest", night: "reading" });
  });
});

describe("constellationLinks (연속일 선)", () => {
  it("연속으로 이어진 두 날끼리만 잇고 빈 날을 건너뛰지 않는다", () => {
    expect(constellationLinks([true, true, false, true, true, true, false])).toEqual([
      [0, 1],
      [3, 4],
      [4, 5],
    ]);
  });
  it("하루만 읽었거나 아무 날도 없으면 선이 없다", () => {
    expect(constellationLinks([false, false, true, false, false, false, false])).toEqual([]);
    expect(constellationLinks([])).toEqual([]);
  });
  it("일주일을 다 읽으면 여섯 선이 월→일로 이어진다", () => {
    expect(constellationLinks(Array(7).fill(true))).toHaveLength(6);
  });

  it("별자리는 연속 구간마다 선을 그리고 훈독한 날만 data-done 이다", () => {
    const { container } = render(
      <WeekConstellation todayWeekday={4} doneByDay={[true, true, false, true, false, false, false]} />,
    );
    // 좁은 화면·넓은 화면 두 벌 × 선 1개(월-화)
    expect(container.querySelectorAll(".week__lines--narrow line")).toHaveLength(1);
    expect(container.querySelectorAll(".week__lines--wide line")).toHaveLength(1);
    expect(container.querySelectorAll(".week__day[data-done]")).toHaveLength(3);
    expect(container.querySelector(".week__day[data-today]")).toHaveAttribute("aria-label", "목요일 · 훈독 완료");
  });
});
