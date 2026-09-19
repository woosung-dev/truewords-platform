import { describe, expect, it } from "vitest";
import { addDays, dateRange, formatDayLabel, isIsoDate, kstTodayIso, LIST_DAYS } from "@/features/hoondok/dates";

describe("훈독 편성 날짜 유틸 (KST 문자열)", () => {
  it("kstTodayIso 는 UTC 15시 이후를 KST 다음날로 본다", () => {
    expect(kstTodayIso(new Date("2026-09-19T14:59:00Z"))).toBe("2026-09-19");
    expect(kstTodayIso(new Date("2026-09-19T15:00:00Z"))).toBe("2026-09-20");
  });

  it("addDays 는 월·연 경계를 넘긴다", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-09-19", 14)).toBe("2026-10-03");
  });

  it("dateRange 는 시작일 포함 days+1 개", () => {
    const range = dateRange("2026-09-19", LIST_DAYS);
    expect(range).toHaveLength(15);
    expect(range[0]).toBe("2026-09-19");
    expect(range[14]).toBe("2026-10-03");
  });

  it("formatDayLabel 은 월/일 (요일)", () => {
    expect(formatDayLabel("2026-09-19")).toBe("9/19 (토)");
    expect(formatDayLabel("2026-10-01")).toBe("10/1 (목)");
  });

  it("isIsoDate 는 형식과 실제 날짜를 함께 본다", () => {
    expect(isIsoDate("2026-09-19")).toBe(true);
    expect(isIsoDate("2026/09/19")).toBe(false);
    expect(isIsoDate("2026-13-45")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});
