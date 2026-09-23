import { describe, expect, it } from "vitest";
import {
  emptyJeongseongValues,
  fromJeongseong,
  JEONGSEONG_STATUS_LABEL,
  jeongseongEndDate,
  jeongseongStatus,
  toJeongseongPayload,
  validateJeongseong,
} from "@/features/hoondok/jeongseong-form";

const valid = { title: "추석 40일 정성", started_on: "2026-09-23", duration_days: "40", source_note: "" };

describe("공식 정성 폼 검증 (API-HD-042 제약과 같다)", () => {
  it("정상 값은 오류 없음", () => {
    expect(validateJeongseong(valid)).toEqual({});
  });

  it("기간 경계 — 1·100 은 통과, 0·101·소수·빈 값은 거부", () => {
    expect(validateJeongseong({ ...valid, duration_days: "1" })).toEqual({});
    expect(validateJeongseong({ ...valid, duration_days: "100" })).toEqual({});
    for (const bad of ["0", "101", "2.5", "", "abc", "-1"]) {
      expect(validateJeongseong({ ...valid, duration_days: bad }).duration_days).toBe("1~100 사이 정수여야 해요");
    }
  });

  it("제목 — 필수, 앞뒤 공백 제외 40자까지", () => {
    expect(validateJeongseong({ ...valid, title: "   " }).title).toBe("제목은 필수예요");
    expect(validateJeongseong({ ...valid, title: "가".repeat(40) })).toEqual({});
    expect(validateJeongseong({ ...valid, title: ` ${"가".repeat(40)} ` })).toEqual({});
    expect(validateJeongseong({ ...valid, title: "가".repeat(41) }).title).toBe("40자 이내로 입력해 주세요");
  });

  it("시작일 — 필수·실존 날짜만", () => {
    expect(validateJeongseong({ ...valid, started_on: "" }).started_on).toBe("시작일은 필수예요");
    expect(validateJeongseong({ ...valid, started_on: "2026-02-30" }).started_on).toBe(
      "날짜는 YYYY-MM-DD 형식이어야 해요",
    );
  });

  it("출처 메모 — 선택, 200자까지", () => {
    expect(validateJeongseong({ ...valid, source_note: "가".repeat(200) })).toEqual({});
    expect(validateJeongseong({ ...valid, source_note: "가".repeat(201) }).source_note).toBe(
      "200자 이내로 입력해 주세요",
    );
  });
});

describe("페이로드", () => {
  it("trim · 숫자 변환 · 빈 출처 메모는 null", () => {
    expect(toJeongseongPayload({ ...valid, title: "  추석  ", duration_days: " 7 ", source_note: "  " })).toEqual({
      title: "추석",
      started_on: "2026-09-23",
      duration_days: 7,
      source_note: null,
    });
    expect(toJeongseongPayload({ ...valid, source_note: " 협회 공지 " }).source_note).toBe("협회 공지");
  });

  it("저장된 항목 → 폼 값 왕복", () => {
    const item = {
      id: "j1",
      title: "추석",
      started_on: "2026-09-23",
      duration_days: 40,
      source_note: null,
      created_at: "2026-09-23T00:00:00",
      updated_at: "2026-09-23T00:00:00",
    };
    const values = fromJeongseong(item);
    expect(values).toEqual({ title: "추석", started_on: "2026-09-23", duration_days: "40", source_note: "" });
    expect(toJeongseongPayload(values)).toEqual({
      title: "추석",
      started_on: "2026-09-23",
      duration_days: 40,
      source_note: null,
    });
  });

  it("새 폼 기본값은 시작일만 채운다", () => {
    expect(emptyJeongseongValues("2026-09-23").started_on).toBe("2026-09-23");
  });
});

describe("진행 상태 (KST 오늘 기준)", () => {
  const today = "2026-09-23";

  it("시작 전 = 예정, 시작일 당일 = 진행 중 1일차", () => {
    expect(jeongseongStatus("2026-09-24", 10, today)).toEqual({ status: "upcoming", dayIndex: null });
    expect(jeongseongStatus("2026-09-23", 10, today)).toEqual({ status: "active", dayIndex: 1 });
  });

  it("마지막 날이 오늘이면 진행 중, 다음 날부터 끝남", () => {
    // 2026-09-14 시작 10일 → 마지막 날 09-23
    expect(jeongseongEndDate("2026-09-14", 10)).toBe("2026-09-23");
    expect(jeongseongStatus("2026-09-14", 10, today)).toEqual({ status: "active", dayIndex: 10 });
    expect(jeongseongStatus("2026-09-13", 10, today)).toEqual({ status: "ended", dayIndex: null });
  });

  it("기간 1일 — 당일만 진행 중", () => {
    expect(jeongseongEndDate(today, 1)).toBe(today);
    expect(jeongseongStatus(today, 1, today).status).toBe("active");
    expect(jeongseongStatus("2026-09-22", 1, today).status).toBe("ended");
  });

  it("월 경계를 넘는 일차 계산", () => {
    expect(jeongseongStatus("2026-08-31", 40, "2026-09-01")).toEqual({ status: "active", dayIndex: 2 });
  });

  it("라벨", () => {
    expect(JEONGSEONG_STATUS_LABEL).toEqual({ active: "진행 중", upcoming: "예정", ended: "끝남" });
  });
});
