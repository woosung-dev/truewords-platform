import { dateRange, LIST_DAYS } from "./dates";
import type { DailyReading } from "./types";

/** 이만큼 채워져 있으면 안심 — runbook 의 편성 완료 기준(7일분)과 같다. */
export const STOCK_SAFE_DAYS = 7;

export type StockLevel = "danger" | "warning" | "ok";

export interface ScheduleStock {
  /** 오늘부터 끊기지 않고 편성(철회 제외)이 있는 날 수. 목록 범위라 최대 LIST_DAYS + 1. */
  days: number;
  /** 첫 빈 날(행 없음·철회). 목록 범위가 모두 차 있으면 null. */
  firstGap: string | null;
  level: StockLevel;
}

/**
 * 편성 재고. 목록 화면이 이미 부르는 API-HD-006(오늘~+14일) 결과만으로 계산한다.
 * 철회는 사용자 홈에서 빈 날과 같으므로 재고로 세지 않는다(ops-check 와 같은 기준).
 */
export function scheduleStock(readings: DailyReading[], today: string): ScheduleStock {
  const live = new Set(
    readings.filter((reading) => reading.review_status !== "withdrawn").map((reading) => reading.reading_date),
  );
  const range = dateRange(today, LIST_DAYS);
  const gapIndex = range.findIndex((iso) => !live.has(iso));
  const days = gapIndex === -1 ? range.length : gapIndex;
  const level: StockLevel = days === 0 ? "danger" : days < STOCK_SAFE_DAYS ? "warning" : "ok";
  return { days, firstGap: gapIndex === -1 ? null : range[gapIndex], level };
}
