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

  it("빈 데이터 시 '데이터가 없습니다' 노출", () => {
    render(<ModesChart rows={[]} loading={false} />);
    expect(screen.getByText("데이터가 없습니다")).toBeInTheDocument();
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
