// BL-6 — ModesChart 컴포넌트 단위 테스트

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ModesChart } from "@/features/analytics/components/modes-chart";
import type { DailyModeCount } from "@/features/analytics/types";

afterEach(() => {
  cleanup();
});

describe("ModesChart", () => {
  it("loading 시 skeleton 노출", () => {
    render(<ModesChart rows={undefined} loading={true} />);
    expect(screen.getByText("일별 모드 분포 (최근 30일, UTC 기준)")).toBeInTheDocument();
  });

  it("빈 데이터면 언제 쌓이는지 한 줄로 알린다", () => {
    render(<ModesChart rows={[]} loading={false} />);
    expect(screen.getByText(/최근 30일 동안 답변 기록이 없어요/)).toBeInTheDocument();
  });

  it("불러오지 못하면 빈 데이터로 보이지 않는다", () => {
    render(<ModesChart rows={undefined} loading={false} error />);
    expect(screen.getByText("불러오지 못했어요.")).toBeInTheDocument();
    expect(screen.queryByText(/답변 기록이 없어요/)).not.toBeInTheDocument();
  });

  it("차트에 모드별 합계 요약을 붙인다", () => {
    const rows: DailyModeCount[] = [
      { date: "2026-05-13", mode: "standard", persona_overridden: false, count: 5 },
      { date: "2026-05-14", mode: "standard", persona_overridden: false, count: 2 },
      { date: "2026-05-14", mode: "pastoral", persona_overridden: false, count: 3 },
    ];
    render(<ModesChart rows={rows} loading={false} />);
    expect(screen.getByRole("img", { name: "최근 30일 모드 분포: 표준 7건, 목회상담 3건" })).toBeInTheDocument();
  });

  it("pastoral override 비율 계산 + 노출", () => {
    const rows: DailyModeCount[] = [
      { date: "2026-05-13", mode: "pastoral", persona_overridden: true, count: 3 },
      { date: "2026-05-13", mode: "pastoral", persona_overridden: false, count: 7 },
      { date: "2026-05-13", mode: "pastoral", persona_overridden: null, count: 2 },
      { date: "2026-05-13", mode: "standard", persona_overridden: false, count: 50 },
    ];
    render(<ModesChart rows={rows} loading={false} />);
    // pastoral 합계 12 (3+7+2), override 3 → 25%
    expect(screen.getByText("pastoral 위기 override 3/12 (25%)")).toBeInTheDocument();
  });

  it("pastoral 데이터 없으면 override 라벨 미노출", () => {
    const rows: DailyModeCount[] = [{ date: "2026-05-13", mode: "standard", persona_overridden: false, count: 5 }];
    render(<ModesChart rows={rows} loading={false} />);
    expect(screen.queryByText(/pastoral 위기 override/)).not.toBeInTheDocument();
  });
});
