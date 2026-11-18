"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { summariesAPI, type SummaryTocItem, type SummaryWork } from "./api";
import { Field, message, normalizeStatus, STATUS, STATUS_TONE, type Status } from "./shared";
import "./summaries.css";

const STATUS_ORDER: (Status | "none")[] = ["published", "review", "draft", "withdrawn", "none"];

// 경전별 목차 모양. 천성경은 편 › 장 › 절, 평화경은 편 › 연설문(제4편 14 만 장까지).
const WORKS: Record<
  SummaryWork,
  { title: string; size: number; sizeLabel: string; unit: string; count: string; here: string }
> = {
  cheonseong: { title: "천성경", size: 199, sizeLabel: "절", unit: "말씀", count: "절", here: "이 절" },
  pyeonghwa: { title: "평화경", size: 182, sizeLabel: "개 연설문·장", unit: "문단", count: "개", here: "이 연설문" },
};
type TocGroup = { title: string; noun: string; rows: SummaryTocItem[] };

function groupToc(rows: SummaryTocItem[]) {
  const pyeons = new Map<number, { title: string; groups: Map<string, TocGroup> }>();
  for (const row of rows) {
    const pyeon = pyeons.get(row.pyeon_no) ?? { title: row.pyeon_title, groups: new Map() };
    // 천성경 절은 장으로, 평화경 장은 연설문으로 묶는다. 장이 없는 평화경 연설문은 한 묶음이다.
    const [key, title, noun] =
      row.jang_no != null
        ? [`jang-${row.jang_no}`, `제${row.jang_no}장 ${row.jang_title ?? ""}`, "절"]
        : row.chapter_no != null
          ? [`item-${row.item_no}`, `${row.item_no}. ${row.item_title ?? ""}`, "장"]
          : ["speeches", "연설문", "편"];
    const group = pyeon.groups.get(key) ?? { title, noun, rows: [] };
    group.rows.push(row);
    pyeon.groups.set(key, group);
    pyeons.set(row.pyeon_no, pyeon);
  }
  return pyeons;
}

function rowTitle(row: SummaryTocItem): ReactNode {
  if (row.jeol_no != null) return `${row.jeol_no}절 ${row.jeol_title ?? ""}`;
  if (row.chapter_no != null) return `${row.chapter_no}장 ${row.chapter_title ?? ""}`;
  return (
    <>
      {row.item_no}. {row.item_title}
      {row.toc_date && <span className="ml-1 font-normal text-muted-foreground">({row.toc_date})</span>}
    </>
  );
}

export function SummaryList() {
  const [work, setWork] = useState<SummaryWork>("cheonseong");
  const meta = WORKS[work];
  const query = useQuery({ queryKey: ["summary-admin", "toc", work], queryFn: () => summariesAPI.toc(work) });
  const [status, setStatus] = useState("");
  const [pyeon, setPyeon] = useState("");
  const [missing, setMissing] = useState("");
  const all = query.data ?? [];
  const pyeonOptions = Array.from(groupToc(all), ([no, item]) => ({ no, title: item.title }));
  const rows = all.filter(
    (row) =>
      (!status || normalizeStatus(row.status) === status) && (!pyeon || row.pyeon_no === Number(pyeon)),
  );
  const counts = all.reduce<Record<string, number>>((acc, row) => {
    const key = normalizeStatus(row.status);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  function changeWork(next: SummaryWork) {
    // 편 번호는 경전마다 다르다 — 거르기를 비운다
    setWork(next);
    setPyeon("");
    setMissing("");
  }
  return (
    <div className="page-wide space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{meta.title} AI 요약 발행 관리</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {meta.title} {all.length || meta.size}
          {meta.sizeLabel}의 AI 요약 상태를 보고, 검수·공개·내리기를 관리합니다.
        </p>
      </header>
      <div role="group" aria-label="경전" className="flex flex-wrap gap-1.5">
        {(Object.keys(WORKS) as SummaryWork[]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={work === key ? "default" : "outline"}
            aria-pressed={work === key}
            onClick={() => changeWork(key)}
          >
            {WORKS[key].title}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="상태">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">전체 상태</option>
            {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((key) => (
              <option key={key} value={key}>
                {STATUS[key]} ({counts[key] ?? 0})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="편">
          <NativeSelect value={pyeon} onChange={(e) => setPyeon(e.target.value)}>
            <option value="">전체 편</option>
            {pyeonOptions.map((item) => (
              <option key={item.no} value={item.no}>
                제{item.no}편 {item.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="pb-2 text-sm text-muted-foreground" aria-live="polite">
          {rows.length}
          {meta.count} 표시
        </p>
      </div>
      {all.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="상태별 개수">
          {STATUS_ORDER.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <dt>
                <StatusBadge tone={STATUS_TONE[key]}>{STATUS[key]}</StatusBadge>
              </dt>
              <dd className="font-medium tabular-nums">{counts[key] ?? 0}</dd>
            </div>
          ))}
        </dl>
      )}
      {query.isPending && <p role="status">발행 목록을 불러오고 있어요.</p>}
      {query.isError && (
        <div role="alert" className="space-y-3">
          <p>{message(query.error)}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            다시 불러오기
          </Button>
        </div>
      )}
      {Array.from(groupToc(rows), ([pyeonNo, pyeonItem]) => (
        <section key={pyeonNo} className="space-y-3" aria-label={`제${pyeonNo}편 ${pyeonItem.title}`}>
          <h2 className="text-lg font-semibold">
            제{pyeonNo}편 {pyeonItem.title}
          </h2>
          {Array.from(pyeonItem.groups, ([groupKey, group]) => (
            <div key={groupKey} className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2">
                <h3 className="text-sm font-medium">{group.title}</h3>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  공개 {group.rows.filter((row) => normalizeStatus(row.status) === "published").length} /{" "}
                  {group.rows.length}
                  {group.noun}
                </span>
              </div>
              <ul className="divide-y">
                {group.rows.map((row) => {
                  const rowStatus = normalizeStatus(row.status);
                  const inner = (
                    <>
                      <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                        <span className="font-medium">{rowTitle(row)}</span>
                        <span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">
                          {meta.unit} {row.paragraph_count}개
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                        <StatusBadge tone={STATUS_TONE[rowStatus]}>{STATUS[rowStatus]}</StatusBadge>
                        {row.published && rowStatus !== "published" && (
                          <StatusBadge tone="success">공개 중</StatusBadge>
                        )}
                        {row.unit_id && <span>그림 {row.image_count}장</span>}
                        {row.text_score != null && <span>점수 {row.text_score}</span>}
                        {row.updated_at && <span>{new Date(row.updated_at).toLocaleDateString("ko-KR")}</span>}
                      </span>
                    </>
                  );
                  return (
                    <li key={row.slug}>
                      {row.unit_id ? (
                        <Link
                          href={`/hoondok/summaries/${row.unit_id}/edit`}
                          className="flex min-h-11 flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="flex min-h-11 w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                          aria-describedby={missing === row.slug ? `missing-${row.slug}` : undefined}
                          onClick={() => setMissing(row.slug)}
                        >
                          {inner}
                        </button>
                      )}
                      {missing === row.slug && (
                        <p id={`missing-${row.slug}`} role="status" className="px-4 pb-3 text-sm text-muted-foreground">
                          콘텐츠 없음: {meta.here}의 AI 요약을 아직 가져오지 않았어요.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
