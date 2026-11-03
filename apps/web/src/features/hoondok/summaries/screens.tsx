"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import type { SummaryDetail } from "@truewords/api-client-ts/types";
import { ArrowRight, BookOpenText } from "lucide-react";
import Link from "next/link";
import { wordsHref, wordsSectionHref } from "../library/api";
import { summariesAPI } from "./api";
import { SummaryFigures } from "./figures";
import { SummaryBody } from "./summary-body";

export const AI_NOTICE = "AI가 만든 이해 도움 자료예요. 공식 해설이 아니에요.";

function Status({ pending, missing, retry }: { pending: boolean; missing?: boolean; retry: () => void }) {
  return <div className="empty" role="status"><BookOpenText size={28} aria-hidden="true" /><p className="empty__title">{pending ? "요약을 불러오고 있어요" : missing ? "지금은 읽을 수 없는 요약이에요" : "요약을 불러오지 못했어요"}</p>{!pending && <><p className="empty__body">{missing ? "공개된 요약을 목록에서 확인해 주세요." : "연결을 확인하고 다시 시도해 주세요."}</p>{missing ? <Link href="/hoondok/summaries" className="btn btn-line">요약 목록</Link> : <button type="button" className="btn btn-line" onClick={retry}>다시 시도</button>}</>}</div>;
}

function textLength(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const value = node as { text?: unknown; content?: unknown };
  const own = typeof value.text === "string" ? value.text.length : 0;
  return own + (Array.isArray(value.content) ? value.content.reduce((sum: number, child) => sum + textLength(child), 0) : 0);
}

/** 한국어 읽기 속도를 분당 약 500자로 잡은 대략값. 최소 1분. */
export function readingMinutes(item: Pick<SummaryDetail, "lead" | "key_points" | "body" | "evidence" | "reflection_questions">): number {
  const chars = item.lead.length + item.key_points.join("").length + textLength(item.body) + item.evidence.map((e) => e.claim).join("").length + item.reflection_questions.join("").length;
  return Math.max(1, Math.round(chars / 500));
}

/** 원문 뷰로 가는 링크. 말씀 번호→원문 조각 매핑이 없어 절이 속한 장(목차 위치)으로 보낸다. */
export function sourceHref(item: Pick<SummaryDetail, "volume" | "section_position" | "source">): string {
  if (item.section_position != null) return wordsSectionHref(item.volume, item.section_position);
  return wordsHref(item.volume, item.source.chunk_ids?.[0]);
}

function range(from: number, to: number) {
  return from === to ? `${from}` : `${from}–${to}`;
}

export function SummaryListScreen({ volume }: { volume?: string }) {
  const query = useQuery({ queryKey: ["hoondok", "summaries", { volume }], queryFn: ({ signal }) => summariesAPI.list(signal, volume), retry: false, staleTime: 0 });
  const items = query.data ?? [];
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const group = groups.get(item.work_title) ?? [];
    group.push(item);
    groups.set(item.work_title, group);
  }
  return <section className="sum-page">
    <header className="sum-header"><h2>AI 요약</h2><p>공개된 절의 AI 요약을 원문과 함께 살펴보세요.</p><p className="sum-notice">{AI_NOTICE}</p></header>
    {(query.isPending || query.isError) ? <Status pending={query.isPending} retry={() => void query.refetch()} /> : items.length === 0 ? <div className="empty"><p className="empty__title">첫 요약을 준비하고 있어요</p><p className="empty__body">검수를 마친 요약부터 차례로 공개해요.</p><Link className="btn btn-line" href={volume ? wordsHref(volume) : "/hoondok/library"}>원문 읽기</Link></div> : Array.from(groups, ([title, summaries]) => <section className="sum-book" key={title}><h3>{title}</h3><ol className="sum-list">{summaries.map((item) => <li key={item.id}><Link href={`/hoondok/summaries/${item.id}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {item.cover_url && <img src={item.cover_url} alt="" loading="lazy" />}<span><small>{item.group_title}</small><strong>{item.title}</strong><small>{item.lead}</small></span><ArrowRight size={18} aria-hidden="true" /></Link></li>)}</ol></section>)}
  </section>;
}

export function SummaryDetailScreen({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["hoondok", "summaries", id], queryFn: ({ signal }) => summariesAPI.detail(id, signal), retry: false, staleTime: 0 });
  const item = query.data;
  if (!item || query.isError) return <section className="sum-page"><Status pending={query.isPending} missing={query.error instanceof ApiError && query.error.status === 404} retry={() => void query.refetch()} /></section>;
  const toSource = sourceHref(item);
  const crumbs = item.group_title.split(" · ").filter(Boolean);
  return <article className="sum-page sum-reading" aria-labelledby="sum-title">
    {/* 1. 머리 — 위치·제목·읽기 시간·고정 안내 */}
    <header className="sum-header">
      <nav aria-label="위치"><ol className="sum-crumb"><li><Link href="/hoondok/library">말씀</Link></li><li><Link href={wordsHref(item.volume)}>{item.work_title}</Link></li>{crumbs.map((crumb) => <li key={crumb}>{crumb}</li>)}</ol></nav>
      <h2 id="sum-title">{item.title}</h2>
      <p className="sum-meta">AI 요약 · 약 {readingMinutes(item)}분</p>
      <p className="sum-notice" role="note">{AI_NOTICE}</p>
    </header>
    {/* 2. 핵심 한 줄 */}
    <section aria-label="핵심 한 줄"><p className="sum-lead">{item.lead}</p></section>
    {/* 3. 요점 */}
    {item.key_points.length > 0 && <section aria-labelledby="sum-points-h"><h3 id="sum-points-h" className="sum-h">요점</h3><ol className="sum-points">{item.key_points.map((point, i) => <li key={i}>{point}</li>)}</ol></section>}
    {/* 4. 그림 — 개념/장면 토글 */}
    <SummaryFigures images={item.images} />
    {/* 5. 차근히 이해하기 */}
    <section aria-labelledby="sum-body-h"><h3 id="sum-body-h" className="sum-h">차근히 이해하기</h3><SummaryBody body={item.body} assets={item.assets ?? []} /></section>
    {/* 6. 근거 확인하기 */}
    {item.evidence.length > 0 && <section aria-labelledby="sum-evidence-h"><h3 id="sum-evidence-h" className="sum-h">근거 확인하기</h3><ul className="sum-evidence">{item.evidence.map((e, i) => <li key={i}><p>{e.claim}</p><Link href={toSource} aria-label={`말씀 ${range(e.from, e.to)} 원문에서 확인하기`}>말씀 {range(e.from, e.to)} 원문 보기 <ArrowRight size={14} aria-hidden="true" /></Link></li>)}</ul></section>}
    {/* 7. 되새길 물음 */}
    {item.reflection_questions.length > 0 && <section className="sum-reflection" aria-labelledby="sum-questions-h"><h3 id="sum-questions-h">되새길 물음</h3><ul>{item.reflection_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></section>}
    {/* 8. 원문과 함께 읽기 */}
    <section className="sum-source" aria-labelledby="sum-source-h"><h3 id="sum-source-h">원문과 함께 읽기</h3><p className="sum-notice">{[item.source.edition, item.source.locator].filter(Boolean).join(" · ")}</p><Link className="btn btn-line" href={toSource}>원문 읽기</Link></section>
    <nav className="sum-next" aria-label="요약 이동"><Link href="/hoondok/summaries">전체 요약</Link>{item.next_id ? <Link href={`/hoondok/summaries/${item.next_id}`}>다음 요약 읽기 <ArrowRight size={16} aria-hidden="true" /></Link> : <span>다음 절은 준비 중이에요</span>}</nav>
  </article>;
}

/** 원문 뷰 머리 표지 — 지금 장에 공개된 절 요약이 있으면 링크로 보인다. */
export function SummaryMarks({ items }: { items: { id: string; title: string }[] }) {
  if (!items.length) return null;
  return <nav className="sum-marks" aria-label="이 장의 AI 요약">{items.map((item) => <Link key={item.id} className="sum-mark" href={`/hoondok/summaries/${item.id}`}><span className="badge">AI 요약</span><span>{item.title}</span></Link>)}</nav>;
}

/** 이 권의 공개 요약 목록. 원문 뷰가 장별 표지를 붙이는 데 쓴다. */
export function usePublishedSummaries(volume: string) {
  return useQuery({ queryKey: ["hoondok", "summaries", { volume }], queryFn: ({ signal }) => summariesAPI.list(signal, volume), retry: false, staleTime: 5 * 60_000 });
}
