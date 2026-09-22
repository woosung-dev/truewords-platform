"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SERIES_TITLE } from "../labels";
import type { SeriesSummaryItem } from "../types";

interface Props {
  query: UseQueryResult<{ items: SeriesSummaryItem[] }>;
  onBulk: (item: SeriesSummaryItem) => void;
}

/** API-HD-028 시리즈 요약표. 청크 수는 시드가 채우기 전까지 null 이라 "—" 로 둔다. */
export default function SeriesSummary({ query, onBulk }: Props) {
  if (query.isPending) return <p role="status">시리즈 요약을 불러오는 중입니다.</p>;
  if (query.isError) {
    return (
      <div role="alert" className="rounded-xl border p-4">
        <p>시리즈 요약을 불러오지 못했습니다.</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          다시 시도
        </Button>
      </div>
    );
  }
  if (query.data.items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-muted-foreground">
        권리 원장이 비어 있어요 — VM 에서 <code>seed_content_rights_from_qdrant.py</code> 를 먼저 실행합니다
      </p>
    );
  }
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>저작물</TableHead>
            <TableHead className="text-right">등록</TableHead>
            <TableHead className="text-right">공개</TableHead>
            <TableHead className="text-right">대기</TableHead>
            <TableHead className="text-right">철회</TableHead>
            <TableHead className="text-right">청크 수</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.items.map((item) => (
            <TableRow key={item.series}>
              <TableCell className="font-medium">{item.title || SERIES_TITLE[item.series] || item.series}</TableCell>
              <TableCell className="text-right">{item.registered}</TableCell>
              <TableCell className="text-right">{item.allowed}</TableCell>
              <TableCell className="text-right">{item.pending}</TableCell>
              <TableCell className="text-right">{item.withdrawn}</TableCell>
              <TableCell className="text-right">{item.chunk_count ?? "—"}</TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onBulk(item)}
                  aria-label={`${item.title} 일괄 변경`}
                >
                  일괄 변경
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
