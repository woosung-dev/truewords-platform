"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { ArrowRight, BookOpenText } from "lucide-react";
import Link from "next/link";
import { wordsHref } from "../library/api";
import { summariesAPI } from "./api";
import { SummaryCarousel } from "./carousel";
import { SummaryBody } from "./summary-body";

// 제공 원문에서 확인한 다음 소제목이다. 세부 구간 공개 전에는 이동할 수 없다.
const nextOutline: Record<string, string> = {
  천성경: "본심작용으로 본 하나님의 실존",
};

function Status({ pending, missing, retry }: { pending: boolean; missing?: boolean; retry: () => void }) {
  return <div className="empty" role="status"><BookOpenText size={28} aria-hidden="true" /><p className="empty__title">{pending ? "요약을 불러오고 있어요" : missing ? "지금은 읽을 수 없는 요약이에요" : "요약을 불러오지 못했어요"}</p>{!pending && <><p className="empty__body">{missing ? "공개된 요약을 목록에서 확인해 주세요." : "연결을 확인하고 다시 시도해 주세요."}</p>{missing ? <Link href="/hoondok/summaries" className="btn btn-line">요약 목록</Link> : <button type="button" className="btn btn-line" onClick={retry}>다시 시도</button>}</>}</div>;
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
    <header className="sum-header"><h2>말씀을 이해하는 또 하나의 길</h2><p>원문에서 출발해, 이미지와 해설로 한 구간씩 살펴보세요.</p></header>
    {(query.isPending || query.isError) ? <Status pending={query.isPending} retry={() => void query.refetch()} /> : items.length === 0 ? <div className="empty"><p className="empty__title">첫 요약을 준비하고 있어요</p><p className="empty__body">검수를 마친 요약부터 차례로 공개해요.</p><Link className="btn btn-line" href={volume ? wordsHref(volume) : "/hoondok/library"}>원문 읽기</Link></div> : Array.from(groups, ([title, summaries]) => <section className="sum-book" key={title}><h3>{title}</h3><ol className="sum-list">{summaries.map((item) => <li key={item.id}>{item.published ? <Link href={`/hoondok/summaries/${item.id}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {item.cover_url && <img src={item.cover_url} alt="" loading="lazy" />}<span><small>{item.group_title}</small><strong>{item.title}</strong><small>{item.lead}</small></span><ArrowRight size={18} aria-hidden="true" /></Link> : <div className="sum-upcoming" aria-disabled="true"><span><small>{item.group_title}</small><strong>{item.title}</strong><small>추후 공개 예정</small></span></div>}</li>)}{nextOutline[title] && !summaries.some((item) => item.title === nextOutline[title]) && <li><div className="sum-upcoming" aria-disabled="true"><span><strong>{nextOutline[title]}</strong><small>추후 공개 예정</small></span></div></li>}</ol></section>)}
    <p className="sum-notice">AI가 정리하고 운영자가 검수한 읽기 도움 자료입니다. 말씀의 정확한 표현은 원문에서 확인해 주세요.</p>
  </section>;
}

export function SummaryDetailScreen({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["hoondok", "summaries", id], queryFn: ({ signal }) => summariesAPI.detail(id, signal), retry: false, staleTime: 0 });
  const item = query.data;
  if (!item || query.isError) return <section className="sum-page"><Status pending={query.isPending} missing={query.error instanceof ApiError && query.error.status === 404} retry={() => void query.refetch()} /></section>;
  return <article className="sum-page">
    <header className="sum-header"><Link href="/hoondok/summaries">요약 목록</Link><p>{[item.work_title, item.group_title].filter(Boolean).join(" / ")}</p><h2>{item.title}</h2><p>{item.source.locator}</p></header>
    <div className="sum-grid">
      <SummaryCarousel key={item.id} slides={item.slides.map((slide) => ({ ...slide, alt: slide.alt ?? "", caption: slide.caption ?? "" }))} />
      <div className="sum-reading"><p className="sum-lead">{item.lead}</p><ul className="sum-points">{item.key_points.map((point, i) => <li key={i}>{point}</li>)}</ul>
        <SummaryBody body={item.body} assets={item.assets ?? []} />
        {item.reflection && <section className="sum-reflection"><h3>돌아볼 질문</h3><p>{item.reflection}</p></section>}
        <details className="sum-source"><summary>이 요약의 원문 살펴보기</summary><p className="sum-notice">{item.source.edition} / {item.source.locator}</p><pre>{item.source.text}</pre><Link className="btn btn-line" href={wordsHref(item.volume, item.source.chunk_ids?.[0])}>원문에서 이어 읽기</Link></details>
        <p className="sum-notice">AI가 정리하고 운영자가 검수한 해설입니다. 인용된 원문과 해설을 구분해 읽어 주세요. 이미지는 이해를 돕기 위해 AI로 제작했습니다.</p>
      </div>
    </div>
    <nav className="sum-next" aria-label="요약 이동"><Link href="/hoondok/summaries">전체 요약</Link>{item.next_id ? <Link href={`/hoondok/summaries/${item.next_id}`}>다음 요약 읽기 <ArrowRight size={16} aria-hidden="true" /></Link> : <span>다음 구간은 준비 중이에요</span>}</nav>
  </article>;
}
