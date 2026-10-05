"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMs, formatValue } from "../format";
import type { StageSpan } from "../types";

type SpanStatus = StageSpan["status"];

const STATUS_BAR: Record<SpanStatus, string> = {
  ok: "bg-primary",
  skipped: "bg-muted-foreground/40",
  error: "bg-destructive",
  timeout: "bg-warning",
  cancelled: "bg-warning",
  short_circuit: "bg-info",
};

const STATUS_BADGE: Record<SpanStatus, { label: string; tone: StatusTone }> = {
  ok: { label: "ok", tone: "success" },
  skipped: { label: "건너뜀", tone: "neutral" },
  error: { label: "오류", tone: "danger" },
  timeout: { label: "시간 초과", tone: "warning" },
  cancelled: { label: "취소", tone: "warning" },
  short_circuit: { label: "조기 종료", tone: "info" },
};

// 모르는 status 는 null — 정상으로 숨기지 않고 중립 막대와 원문 배지로 보인다.
function normalizeStatus(status: string): SpanStatus | null {
  const s = status.toLowerCase();
  return s in STATUS_BAR ? (s as SpanStatus) : null;
}

export function statusBadge(status: string): { label: string; tone: StatusTone } | null {
  const known = normalizeStatus(status);
  if (known === null) return { label: status, tone: "neutral" };
  return known === "ok" ? null : STATUS_BADGE[known];
}

function statusBar(status: string): string {
  const known = normalizeStatus(status);
  return known === null ? "bg-muted-foreground/40" : STATUS_BAR[known];
}

// 좁은 화면에서는 이름 열을 고정 폭으로 줄여 막대 열 폭을 확보한다.
// minmax(a,b) 열은 1fr 보다 먼저 b 까지 커지므로 sm 미만에서는 쓰지 않는다.
const ROW_GRID = "grid grid-cols-[6rem_1fr_3.5rem] gap-2 sm:grid-cols-[minmax(9rem,14rem)_1fr_4.5rem] sm:gap-3";

// 막대 위치·폭(%). analytics FallbackDistribution 과 같은 CSS 막대 방식이다.
// 아주 짧은 span 도 보이도록 폭은 최소 0.5%, 오른쪽 끝을 넘지 않게 자른다.
export function barGeometry(startMs: number, durationMs: number, totalMs: number): { left: number; width: number } {
  if (!(totalMs > 0)) return { left: 0, width: 0 };
  const left = Math.min(Math.max((startMs / totalMs) * 100, 0), 100);
  const raw = Math.max((durationMs / totalMs) * 100, 0.5);
  return { left, width: Math.min(raw, 100 - left) };
}

type Row =
  | { type: "span"; span: StageSpan; id: number; depth: number }
  | { type: "group"; name: string; spans: StageSpan[]; depth: number };

// 최상위 span 을 시작 순으로 놓고 하위 호출(parent = stage 이름)을 그 아래 들여 쓴다.
// 같은 parallel_group 의 최상위 span 은 그룹 행 하나로 묶고 구성원을 그 아래에 둔다.
export function buildRows(spans: StageSpan[]): Row[] {
  const indexed = spans.map((span, id) => ({ span, id }));
  const names = new Set(spans.map((s) => s.name));
  const children = new Map<string, { span: StageSpan; id: number }[]>();
  const roots: { span: StageSpan; id: number }[] = [];
  for (const item of indexed) {
    const parent = item.span.parent;
    if (parent && parent !== item.span.name && names.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(item);
      children.set(parent, list);
    } else {
      roots.push(item);
    }
  }
  const byStart = (a: { span: StageSpan }, b: { span: StageSpan }) => a.span.start_ms - b.span.start_ms;
  roots.sort(byStart);

  const rows: Row[] = [];
  const visited = new Set<number>();
  const usedParents = new Set<string>();
  function pushSpan(item: { span: StageSpan; id: number }, depth: number) {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    rows.push({ type: "span", span: item.span, id: item.id, depth });
    // 같은 이름 stage 가 둘이면 하위 호출은 처음 것에만 붙인다.
    if (usedParents.has(item.span.name)) return;
    usedParents.add(item.span.name);
    for (const child of [...(children.get(item.span.name) ?? [])].sort(byStart)) pushSpan(child, depth + 1);
  }

  const emittedGroups = new Set<string>();
  for (const root of roots) {
    const group = root.span.parallel_group;
    if (!group) {
      pushSpan(root, 0);
      continue;
    }
    if (emittedGroups.has(group)) continue;
    emittedGroups.add(group);
    const members = roots.filter((r) => r.span.parallel_group === group);
    rows.push({ type: "group", name: group, spans: members.map((m) => m.span), depth: 0 });
    for (const m of members) pushSpan(m, 1);
  }
  return rows;
}

export function waterfallTotal(spans: StageSpan[], totalMs: number): number {
  return spans.reduce((max, s) => Math.max(max, s.start_ms + s.duration_ms), totalMs);
}

function Bar({ span, total, overlap }: { span: StageSpan; total: number; overlap?: boolean }) {
  const { left, width } = barGeometry(span.start_ms, span.duration_ms, total);
  return (
    <span
      data-testid="waterfall-bar"
      className={cn(
        "absolute inset-y-0 block rounded-sm",
        statusBar(span.status),
        overlap && "opacity-50 ring-1 ring-card",
      )}
      style={{ left: `${left}%`, width: `${width}%` }}
    />
  );
}

function SpanDetail({ span }: { span: StageSpan }) {
  const rows: [string, string, unknown][] = [
    ...Object.entries(span.input ?? {}).map(([k, v]) => ["input", k, v] as [string, string, unknown]),
    ...Object.entries(span.output ?? {}).map(([k, v]) => ["output", k, v] as [string, string, unknown]),
  ];
  if (span.llm) {
    rows.push(["llm", "model", span.llm.model]);
    rows.push(["llm", "tokens (in/out)", `${span.llm.input_tokens ?? "–"} / ${span.llm.output_tokens ?? "–"}`]);
  }
  if (span.ttft_ms != null) rows.push(["llm", "ttft", formatMs(span.ttft_ms)]);
  if (span.error) rows.push(["error", "message", span.error]);

  if (rows.length === 0) return <p className="px-2 py-2 text-xs text-muted-foreground">기록된 입력·출력이 없습니다</p>;
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">구분</TableHead>
          <TableHead className="w-40">키</TableHead>
          <TableHead>값</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([section, k, v], i) => (
          <TableRow key={`${section}-${k}-${i}`}>
            <TableCell className="text-muted-foreground">{section}</TableCell>
            <TableCell className="font-mono">{k}</TableCell>
            <TableCell className="font-mono whitespace-pre-wrap break-all">{formatValue(v)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function StageWaterfall({ spans, totalMs }: { spans: StageSpan[]; totalMs: number }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const total = waterfallTotal(spans, totalMs);
  const rows = buildRows(spans);

  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section aria-label="단계별 워터폴" className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">단계별 워터폴</h2>
        <span className="text-xs text-muted-foreground tabular-nums">0 – {formatMs(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">기록된 단계가 없습니다</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => {
            if (row.type === "group") {
              const start = Math.min(...row.spans.map((s) => s.start_ms));
              const end = Math.max(...row.spans.map((s) => s.start_ms + s.duration_ms));
              return (
                <li key={`group-${row.name}`} className={cn(ROW_GRID, "items-center px-2 py-1")}>
                  <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{row.name} (병렬)</span>
                  <div className="relative h-3 w-full rounded-sm bg-admin-muted" data-testid="waterfall-group">
                    {row.spans.map((s, i) => (
                      <Bar key={`${s.name}-${i}`} span={s} total={total} overlap />
                    ))}
                  </div>
                  <span className="text-right text-xs tabular-nums text-muted-foreground">{formatMs(end - start)}</span>
                </li>
              );
            }
            const { span, id, depth } = row;
            const badge = statusBadge(span.status);
            const expanded = open.has(id);
            return (
              <Fragment key={id}>
                <li>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggle(id)}
                    className={cn(
                      ROW_GRID,
                      "w-full items-center rounded-md px-2 py-1 text-left hover:bg-admin-muted/40 focus-visible:outline-2 focus-visible:outline-ring",
                    )}
                  >
                    <span
                      className="flex min-w-0 items-center gap-1.5 text-xs"
                      style={{ paddingLeft: `${depth * 1}rem` }}
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
                      />
                      <span className={cn("truncate font-mono", depth > 0 && "text-muted-foreground")}>
                        {span.name}
                      </span>
                      {badge && (
                        <StatusBadge tone={badge.tone} className="h-4 px-1.5 text-[10px]">
                          {badge.label}
                        </StatusBadge>
                      )}
                    </span>
                    {/* button 안은 phrasing content 만 허용돼 막대 틀도 span 으로 둔다. */}
                    <span className="relative block h-3 w-full rounded-sm bg-admin-muted">
                      <Bar span={span} total={total} />
                    </span>
                    <span className="text-right text-xs tabular-nums">{formatMs(span.duration_ms)}</span>
                  </button>
                </li>
                {expanded && (
                  <li className="rounded-md border bg-admin-muted/20 ml-2">
                    <SpanDetail span={span} />
                  </li>
                )}
              </Fragment>
            );
          })}
        </ul>
      )}
    </section>
  );
}
