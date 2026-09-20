"use client";

/**
 * 편성 후보 찾기 패널 (API-HD-012, PLAN-HD-003).
 *
 * 말씀 코퍼스에서 **원문 그대로** 후보를 찾아 보여 주고, 고르면 폼을 채운다.
 * 생성 AI 가 문장을 만들지 않는다 — 여기 보이는 본문은 서버가 검색해 온 청크 그 자체다.
 * 고른 뒤에도 편성자가 모든 필드를 고칠 수 있고, 등급은 R(권리 확인 중)로 들어간다.
 *
 * admin UI 에 Checkbox·Badge 컴포넌트가 없어 raw 태그를 쓴다(daily-reading-form 과 같은 관례).
 */

import { useQuery } from "@tanstack/react-query";
import { Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { hoondokAPI } from "@/features/hoondok/api";
import { SOURCE_KEYS, SOURCE_LABEL } from "@/features/hoondok/labels";
import type { DailyReadingCandidate } from "@/features/hoondok/types";

export interface CandidatePanelProps {
  /** 후보를 고르면 호출된다. 페이지가 폼을 이 값으로 다시 그린다. */
  onPick: (candidate: DailyReadingCandidate) => void;
}

/** 제출된 검색 조건. null 이면 아직 검색 전이라 요청을 보내지 않는다. */
interface SubmittedQuery {
  q: string;
  sources: string[];
}

export function CandidatePanel({ onPick }: CandidatePanelProps) {
  const [term, setTerm] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<SubmittedQuery | null>(null);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["hoondok", "candidates", submitted],
    queryFn: () => hoondokAPI.candidates({ q: submitted!.q, sources: submitted!.sources }),
    enabled: submitted !== null,
    staleTime: 60_000,
  });

  function toggleSource(key: string) {
    setSources((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function submit() {
    const q = term.trim();
    if (!q) return;
    setSubmitted({ q, sources });
  }

  const candidates = data?.candidates ?? [];
  const searched = submitted !== null && !isFetching && !isError;

  return (
    <section aria-labelledby="candidate-panel-heading" className="rounded-lg border bg-muted/30 p-4 mb-6 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
        <div>
          <h2 id="candidate-panel-heading" className="text-sm font-medium">
            말씀에서 후보 찾기
          </h2>
          <p className="text-xs text-muted-foreground">
            검색 결과는 원문 그대로예요. 고르면 아래 폼이 채워지고, 등급은 <b>권리 확인 중</b>으로 들어가요.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <Label htmlFor="candidate-q" className="sr-only">
            주제나 키워드
          </Label>
          <Input
            id="candidate-q"
            value={term}
            placeholder="주제나 키워드 (예: 참사랑, 효정, 가정)"
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              // 폼 안에 있으므로 Enter 가 편성 등록으로 새지 않게 막는다.
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <Button type="button" onClick={submit} disabled={!term.trim() || isFetching}>
          <Search className="w-4 h-4" aria-hidden />
          {isFetching ? "찾는 중..." : "찾기"}
        </Button>
      </div>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
        <legend className="sr-only">출처 범위</legend>
        {SOURCE_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={sources.includes(key)}
              onChange={() => toggleSource(key)}
              className="rounded border-input"
            />
            {SOURCE_LABEL[key]}
          </label>
        ))}
        <span className="text-xs text-muted-foreground">선택하지 않으면 전체에서 찾아요</span>
      </fieldset>

      {isFetching && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {isError && (
        <p role="alert" className="text-xs text-destructive">
          말씀 검색에 실패했어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}

      {searched && candidates.length === 0 && (
        <p className="text-xs text-muted-foreground">
          조건에 맞는 후보가 없어요. 다른 키워드로 찾거나 출처 범위를 넓혀 보세요.
        </p>
      )}

      {searched && candidates.length > 0 && (
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.chunk_id} className="rounded-lg border bg-background p-3 space-y-2">
              <p className="text-sm leading-relaxed line-clamp-3">{c.text}</p>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground truncate">
                  {c.source_label}
                  {c.work_title && ` · ${c.work_title}`} · {c.char_count}자
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => onPick(c)}>
                  이 말씀으로 채우기
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
