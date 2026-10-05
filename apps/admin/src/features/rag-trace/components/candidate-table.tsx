"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TruncateTooltip } from "@/features/analytics/components/truncate-tooltip";
import type { CandidateRow } from "../types";

type DropStage = NonNullable<CandidateRow["drop_stage"]>;

// 파이프라인 순서. 정렬도 이 순서를 따른다.
const DROP_STAGE: Record<DropStage, { label: string; tone: StatusTone; order: number }> = {
  not_retrieved: { label: "미검색", tone: "danger", order: 0 },
  filtered: { label: "필터 제외", tone: "danger", order: 1 },
  fusion_cut: { label: "융합 탈락", tone: "warning", order: 2 },
  below_threshold: { label: "점수 미달", tone: "warning", order: 3 },
  tier_not_reached: { label: "tier 미도달", tone: "neutral", order: 4 },
  merge_cut: { label: "병합 탈락", tone: "warning", order: 5 },
  rerank_cut: { label: "rerank 탈락", tone: "warning", order: 6 },
  context_cut: { label: "context 탈락", tone: "info", order: 7 },
  kept: { label: "포함", tone: "success", order: 8 },
};

// 알 수 없는 값·null 은 판정 보류(rerank 미완료 등)로 본다.
export function normalizeDropStage(value: string | null | undefined): DropStage | null {
  if (!value) return null;
  const v = value.toLowerCase();
  return v in DROP_STAGE ? (v as DropStage) : null;
}

export function DropStageBadge({ value }: { value: string | null | undefined }) {
  const stage = normalizeDropStage(value);
  if (stage === null) return <StatusBadge tone="neutral">판정 보류</StatusBadge>;
  const { label, tone } = DROP_STAGE[stage];
  return (
    <StatusBadge tone={tone} title={stage}>
      {label}
    </StatusBadge>
  );
}

type SortKey =
  | "key"
  | "volume"
  | "source"
  | "origin"
  | "dense_rank"
  | "sparse_rank"
  | "rrf_score"
  | "qualified"
  | "tier_idx"
  | "rerank_rank"
  | "context_rank"
  | "cited_rank"
  | "drop_stage";

const COLUMNS: { key: SortKey; label: string; title?: string; numeric?: boolean }[] = [
  { key: "key", label: "key" },
  { key: "volume", label: "volume" },
  { key: "source", label: "source" },
  { key: "origin", label: "origin" },
  { key: "dense_rank", label: "dense#", numeric: true },
  { key: "sparse_rank", label: "sparse#", numeric: true },
  { key: "rrf_score", label: "RRF", numeric: true, title: "1/(2+dense순위)+1/(2+sparse순위) ≥ 0.1" },
  { key: "qualified", label: "cutoff", title: "tier 점수 기준 통과 여부" },
  { key: "tier_idx", label: "tier", numeric: true, title: "tier 번호(0부터, weighted 는 source 순서)" },
  { key: "rerank_rank", label: "rerank#(Δ)", numeric: true, title: "Δ = fused# − rerank# (양수면 rerank 로 올라감)" },
  { key: "context_rank", label: "ctx#", numeric: true },
  { key: "cited_rank", label: "인용#", numeric: true },
  { key: "drop_stage", label: "탈락 단계" },
];

function sortValue(row: CandidateRow, key: SortKey): string | number | null {
  switch (key) {
    case "drop_stage": {
      const stage = normalizeDropStage(row.drop_stage);
      return stage === null ? null : DROP_STAGE[stage].order;
    }
    case "qualified":
      return row.qualified == null ? null : row.qualified ? 1 : 0;
    case "origin":
      return row.origin.toLowerCase();
    default: {
      const v = row[key];
      return v === undefined ? null : v;
    }
  }
}

// null 은 방향과 상관없이 맨 뒤.
export function sortCandidates(rows: CandidateRow[], key: SortKey | null, dir: "asc" | "desc"): CandidateRow[] {
  if (key === null) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
    return String(va).localeCompare(String(vb)) * sign;
  });
}

function rank(v: number | null | undefined) {
  return v == null ? <span className="text-muted-foreground">–</span> : v;
}

function RerankCell({ row }: { row: CandidateRow }) {
  if (row.rerank_rank == null) return rank(null);
  const delta = row.fused_rank != null ? row.fused_rank - row.rerank_rank : null;
  return (
    <span title={row.rerank_score != null ? `rerank 점수 ${row.rerank_score.toFixed(3)}` : undefined}>
      {row.rerank_rank}
      {delta !== null && delta !== 0 && (
        <span className={delta > 0 ? "ml-1 text-success" : "ml-1 text-destructive"}>
          ({delta > 0 ? `+${delta}` : delta})
        </span>
      )}
    </span>
  );
}

export function CandidateTable({ candidates }: { candidates: CandidateRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [droppedOnly, setDroppedOnly] = useState(false);

  const rows = useMemo(() => {
    const filtered = droppedOnly
      ? candidates.filter((c) => {
          const stage = normalizeDropStage(c.drop_stage);
          return stage !== null && stage !== "kept";
        })
      : candidates;
    return sortCandidates(filtered, sortKey, dir);
  }, [candidates, droppedOnly, sortKey, dir]);

  function onSort(key: SortKey) {
    if (sortKey === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir("asc");
    }
  }

  return (
    <section aria-label="후보 문서" className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          후보 문서 <span className="text-muted-foreground font-normal">{candidates.length}건</span>
        </h2>
        <div className="flex items-center gap-2.5">
          <Checkbox id="trace-dropped-only" checked={droppedOnly} onCheckedChange={(c) => setDroppedOnly(c === true)} />
          <Label htmlFor="trace-dropped-only" className="cursor-pointer text-xs">
            탈락만
          </Label>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {candidates.length === 0 ? "검색 후보가 없습니다" : "조건에 맞는 후보가 없습니다"}
        </p>
      ) : (
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                return (
                  <TableHead
                    key={col.key}
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
                    className={col.numeric ? "text-right" : undefined}
                  >
                    <button
                      type="button"
                      title={col.title}
                      onClick={() => onSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {col.label}
                      {active &&
                        (dir === "asc" ? (
                          <ArrowUp aria-hidden="true" className="size-3" />
                        ) : (
                          <ArrowDown aria-hidden="true" className="size-3" />
                        ))}
                    </button>
                  </TableHead>
                );
              })}
              <TableHead>미리보기</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              // 같은 chunk 가 중복 행으로 올 수 있어 key 에 위치를 섞는다.
              <TableRow key={`${row.chunk_id}-${row.duplicate_of ?? ""}-${i}`} data-testid="candidate-row">
                <TableCell className="font-mono">
                  {row.key}
                  {row.duplicate_of && (
                    <StatusBadge
                      tone="warning"
                      className="ml-1 h-4 px-1.5 text-[10px]"
                      title={`중복: ${row.duplicate_of}`}
                    >
                      중복
                    </StatusBadge>
                  )}
                </TableCell>
                <TableCell>{row.volume || "–"}</TableCell>
                <TableCell>{row.source || "–"}</TableCell>
                <TableCell>{row.origin.toLowerCase() === "fallback_relaxed" ? "완화" : "hybrid"}</TableCell>
                <TableCell className="text-right tabular-nums">{rank(row.dense_rank)}</TableCell>
                <TableCell className="text-right tabular-nums">{rank(row.sparse_rank)}</TableCell>
                <TableCell className="text-right tabular-nums" title="1/(2+dense순위)+1/(2+sparse순위) ≥ 0.1">
                  {row.rrf_score == null ? rank(null) : row.rrf_score.toFixed(4)}
                </TableCell>
                <TableCell>{row.qualified == null ? rank(null) : row.qualified ? "통과" : "미달"}</TableCell>
                <TableCell className="text-right tabular-nums">{rank(row.tier_idx)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <RerankCell row={row} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{rank(row.context_rank)}</TableCell>
                <TableCell className="text-right tabular-nums">{rank(row.cited_rank)}</TableCell>
                <TableCell>
                  <DropStageBadge value={row.drop_stage} />
                </TableCell>
                <TableCell className="max-w-64 min-w-40">
                  <TruncateTooltip text={row.preview || "–"} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
