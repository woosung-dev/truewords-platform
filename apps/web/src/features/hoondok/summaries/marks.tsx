"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { summariesAPI } from "./api";

/** 원문 뷰 머리 표지 — 지금 장에 공개된 절 요약이 있으면 링크로 보인다. */
export function SummaryMarks({ items }: { items: { id: string; title: string }[] }) {
  if (!items.length) return null;
  return <nav className="sum-marks" aria-label="이 장의 AI 요약"><p className="sum-marks__lab"><Sparkles size={15} aria-hidden="true" />이 장의 AI 요약 {items.length}개</p><ul>{items.map((item) => <li key={item.id}><Link className="sum-mark" href={`/summaries/${item.id}`}><span className="sum-sr">AI 요약 </span><span className="sum-mark__t">{item.title}</span><ChevronRight size={16} aria-hidden="true" /></Link></li>)}</ul></nav>;
}

/** 이 권의 공개 요약 목록. 원문 뷰가 장별 표지를 붙이는 데 쓴다. */
export function usePublishedSummaries(volume: string) {
  return useQuery({ queryKey: ["hoondok", "summaries", { volume }], queryFn: ({ signal }) => summariesAPI.list(signal, volume), retry: false, staleTime: 5 * 60_000 });
}
