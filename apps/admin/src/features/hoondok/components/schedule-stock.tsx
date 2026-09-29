"use client";

import { CalendarPlus, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { addDays, formatDayLabel } from "../dates";
import { type ScheduleStock, STOCK_SAFE_DAYS, scheduleStock } from "../stock";
import { useUpcomingReadings } from "../use-upcoming-readings";

// 빈 날에 사용자 쪽에서 일어나는 일. 푸시 발송기(push_sender)는 오늘 편성이 없으면 정성 진행자에게만 보낸다.
const EMPTY_DAY_EFFECT = "사용자 홈에 오늘 말씀이 보이지 않고, 정성 진행자 말고는 훈독 알림이 가지 않아요.";

/**
 * 편성 목록 위 재고 표시. 0일은 위험, 1~6일은 경고(첫 빈 날로 바로 가는 버튼), 7일 이상은 상자 없는 한 줄.
 * 색만으로 구분하지 않도록 모든 상태가 일수를 글자로 말한다.
 * 첫 빈 날이 철회된 편성(`firstGapReadingId`)이면 버튼은 그 편성의 수정 화면으로 간다 — 같은 날짜로 새로 만들면 409.
 */
export function ScheduleStockBanner({
  stock,
  today,
  firstGapReadingId,
}: {
  stock: ScheduleStock;
  today: string;
  firstGapReadingId?: string;
}) {
  if (stock.level === "ok" || stock.firstGap === null) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <CircleCheck className="w-4 h-4 shrink-0 text-success" aria-hidden="true" />
        {stock.firstGap === null ? (
          <span>앞으로 {stock.days}일분 이상 채워져 있어요</span>
        ) : (
          <span>
            앞으로 {stock.days}일분 채워져 있어요
            <span className="font-normal text-muted-foreground">
              {" "}
              · {formatDayLabel(addDays(today, stock.days - 1))}까지
            </span>
          </span>
        )}
      </p>
    );
  }

  const isDanger = stock.level === "danger";
  const gapLabel = formatDayLabel(stock.firstGap);
  const Icon = isDanger ? CircleAlert : TriangleAlert;
  const actionHref = firstGapReadingId ? `/hoondok/${firstGapReadingId}/edit` : `/hoondok/new?date=${stock.firstGap}`;
  return (
    <div
      role={isDanger ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-lg border p-4 ${
        isDanger ? "border-danger-border bg-danger-soft" : "border-warning-border bg-warning-soft"
      }`}
    >
      <Icon
        className={`w-5 h-5 mt-0.5 shrink-0 ${isDanger ? "text-destructive" : "text-warning"}`}
        aria-hidden="true"
      />
      <div className="flex flex-1 min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="font-semibold">
            {isDanger ? (
              "오늘 말씀이 비어 있어요"
            ) : (
              <>
                앞으로 <b className="tabular-nums">{stock.days}일분</b> 남았어요. {stock.days === 1 && "내일 "}
                {gapLabel}부터 비어 있어요
              </>
            )}
          </p>
          <p className="text-sm">
            {isDanger
              ? `지금 ${EMPTY_DAY_EFFECT}`
              : stock.days === 1
                ? "오늘 안에 내일 말씀을 넣어 두면 내일 아침 사용자 홈이 비지 않아요."
                : `빈 날에는 ${EMPTY_DAY_EFFECT} ${STOCK_SAFE_DAYS}일분 이상 채워 두면 안심이에요.`}
          </p>
        </div>
        <Link href={actionHref} className={buttonVariants({ className: "self-start sm:self-center" })}>
          <CalendarPlus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          {isDanger ? "오늘" : gapLabel} 편성하기
        </Link>
      </div>
    </div>
  );
}

/** 사이드바 "훈독 편성" 옆 남은 일수. 7일 이상·불러오는 중·오류면 아무것도 그리지 않는다. */
export function ScheduleStockNavBadge() {
  const { from, data, isError } = useUpcomingReadings();
  if (!data || isError) return null;
  const stock = scheduleStock(data, from);
  if (stock.level === "ok") return null;
  return (
    <StatusBadge tone={stock.level} className="ml-auto tabular-nums">
      <span aria-hidden="true">{stock.days}일</span>
      <span className="sr-only">{stock.days === 0 ? "오늘 편성 없음" : `${stock.days}일분 남음`}</span>
    </StatusBadge>
  );
}
