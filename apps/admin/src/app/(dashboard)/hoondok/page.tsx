"use client";

import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScheduleStockBanner } from "@/features/hoondok/components/schedule-stock";
import { dateRange, formatDayLabel, LIST_DAYS } from "@/features/hoondok/dates";
import { GRADE_LABEL, REVIEW_LABEL } from "@/features/hoondok/labels";
import { scheduleStock } from "@/features/hoondok/stock";
import type { ReviewStatus } from "@/features/hoondok/types";
import { useUpcomingReadings } from "@/features/hoondok/use-upcoming-readings";

// 검수 상태 배지 — 챗봇 목록의 활성/비활성 배지 토큰을 그대로 쓴다(새 디자인 없음).
const REVIEW_BADGE: Record<ReviewStatus, string> = {
  reviewed: "bg-success-soft text-success hover:bg-success-soft border border-success-border",
  unverified: "bg-transparent text-muted-foreground hover:bg-transparent border border-dashed border-border",
  withdrawn: "bg-destructive/10 text-destructive hover:bg-destructive/10 border border-destructive/30",
};

/** 오늘(KST)부터 14일 — 편성 없는 날은 "미편성" 행으로 보여 빠진 날을 바로 채울 수 있게 한다. */
export default function HoondokReadingsPage() {
  const { from, data, isLoading, isError, refetch } = useUpcomingReadings();

  const days = dateRange(from, LIST_DAYS);
  const byDate = new Map((data ?? []).map((reading) => [reading.reading_date, reading]));
  const scheduled = days.filter((iso) => byDate.has(iso)).length;
  // 재고 배너·첫 빈 날 표시는 목록과 같은 응답으로 계산한다. 오류면 기존 오류 화면만 보인다.
  const stock = data && !isError ? scheduleStock(data, from) : null;
  const firstGap = stock && stock.level !== "ok" ? stock.firstGap : null;

  return (
    <div className="space-y-5 page-wide">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">훈독 편성</h1>
          <p className="text-sm text-muted-foreground mt-1">
            오늘부터 {days.length}일
            {data && (
              <span className="ml-1">
                · 편성 {scheduled}일 · 미편성 {days.length - scheduled}일
              </span>
            )}
          </p>
        </div>
        <Link href="/hoondok/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="w-4 h-4 mr-1.5" />새 편성
        </Link>
      </div>

      {isLoading ? (
        <Skeleton className="h-5 w-72" />
      ) : (
        stock && (
          <ScheduleStockBanner
            stock={stock}
            today={from}
            firstGapReadingId={firstGap ? byDate.get(firstGap)?.id : undefined}
          />
        )
      )}

      {isLoading ? (
        <div className="rounded-xl border bg-card overflow-hidden">
          {["s1", "s2", "s3", "s4", "s5"].map((key, i) => (
            <div key={key} className={`px-5 py-4 ${i !== 0 ? "border-t" : ""}`}>
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <p className="text-muted-foreground text-sm">편성 목록을 불러올 수 없습니다.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-admin-muted/40 hover:bg-admin-muted/40">
                <TableHead className="font-semibold text-foreground">날짜</TableHead>
                <TableHead className="font-semibold text-foreground">제목</TableHead>
                <TableHead className="font-semibold text-foreground">출처</TableHead>
                <TableHead className="font-semibold text-foreground">공식성</TableHead>
                <TableHead className="font-semibold text-foreground">검수</TableHead>
                <TableHead className="font-semibold text-foreground">분</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((iso, index) => {
                const reading = byDate.get(iso);
                const isToday = index === 0;
                const isFirstGap = iso === firstGap;
                return (
                  <TableRow
                    key={iso}
                    data-date={iso}
                    data-today={isToday ? "true" : undefined}
                    data-first-gap={isFirstGap ? "true" : undefined}
                    className={
                      isFirstGap ? "bg-warning-soft hover:bg-warning-soft" : "hover:bg-admin-muted/30 transition-colors"
                    }
                  >
                    <TableCell className={isToday ? "font-medium" : undefined}>
                      {formatDayLabel(iso)}
                      {isToday && (
                        <Badge variant="secondary" className="ml-2">
                          오늘
                        </Badge>
                      )}
                    </TableCell>
                    {/* 1440px 화면(page-wide 72rem)에서 검수·편집 열까지 가로 스크롤 없이 보이도록 제목·출처 폭을 줄인다. */}
                    <TableCell className="max-w-[22rem] truncate" title={reading?.title}>
                      {reading ? (
                        <span
                          className={
                            reading.review_status === "withdrawn" ? "line-through text-muted-foreground" : "font-medium"
                          }
                        >
                          {reading.title}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">미편성</span>
                      )}
                      {isFirstGap && (
                        <StatusBadge tone="warning" className="ml-2">
                          첫 빈 날
                        </StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[14rem] truncate">
                      {reading ? `${reading.speaker} · ${reading.work_title}` : "—"}
                    </TableCell>
                    <TableCell>
                      {reading && <Badge variant="secondary">{GRADE_LABEL[reading.authority_grade]}</Badge>}
                    </TableCell>
                    <TableCell>
                      {reading && (
                        <Badge className={REVIEW_BADGE[reading.review_status]}>
                          {REVIEW_LABEL[reading.review_status]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {reading ? `${reading.estimated_minutes}분` : ""}
                    </TableCell>
                    <TableCell>
                      {reading ? (
                        <Link
                          href={`/hoondok/${reading.id}/edit`}
                          className={buttonVariants({
                            variant: isFirstGap ? "outline" : "ghost",
                            size: "sm",
                            className: "text-muted-foreground hover:text-foreground",
                          })}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1.5" />
                          편집
                        </Link>
                      ) : (
                        <Link
                          href={`/hoondok/new?date=${iso}`}
                          className={buttonVariants({ variant: isFirstGap ? "outline" : "ghost", size: "sm" })}
                        >
                          <Plus className="w-3.5 h-3.5 mr-1.5" />
                          편성하기
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
