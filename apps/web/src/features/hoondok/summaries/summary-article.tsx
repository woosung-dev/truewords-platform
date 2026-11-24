"use client";

// 원문 뷰 "AI 설명" 탭의 공개 AI 요약 — 한 편의 글로 읽는다(블로그형).
// 그림은 따로 떼지 않고 글 흐름 안에 둔다. 문단 끝 근거 번호를 누르면 원문 뷰를 떠나지 않고
// 근거 원문 미리보기 시트가 올라온다(EvidenceViewer). 열림 상태는 지역 상태라 원문 뷰 주소를 바꾸지 않는다.
import { useQuery } from "@tanstack/react-query";
import type { SummaryDetail, SummaryPublicImage } from "@truewords/api-client-ts/types";
import { ArrowRight, BookOpenText, Info, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { aiSummaryKey } from "../query-keys";
import { summariesAPI } from "./api";
import { EvidenceViewer, type PreviewableEvidence, previewableEvidence, rangeLabel } from "./evidence-viewer";
import { AI_NOTICE, readingMinutes } from "./screens";
import { SummaryBody } from "./summary-body";

function InlineFigure({ image }: { image: SummaryPublicImage | undefined }) {
  if (!image) return null;
  return (
    <figure className="sum-art__fig">
      {/* 권리 검사를 거치는 같은 origin 이미지라 이미지 프록시 캐시를 쓰지 않는다. 설명은 alt 에만 둔다. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.alt} loading="lazy" />
    </figure>
  );
}

/** 문단 끝 "(말씀 5–7)" 의 첫 번호로 미리보기 근거를 찾는다. 범위 안에 들면 같은 근거로 본다. */
export function findEvidence(evidence: PreviewableEvidence[], from: number): number {
  const exact = evidence.findIndex((item) => item.from === from);
  if (exact >= 0) return exact;
  return evidence.findIndex((item) => item.from <= from && from <= item.to);
}

function Article({
  item,
  onBackToText,
  onOpenSource,
}: {
  item: SummaryDetail;
  onBackToText: () => void;
  onOpenSource: (evidence: PreviewableEvidence) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const previewable = previewableEvidence(item.evidence);
  const unit = item.paragraph_label ?? "말씀";
  const concept = item.images.find((image) => image.kind === "concept");
  const scene = item.images.find((image) => image.kind === "scene");
  const onCite = (from: number) => {
    const index = findEvidence(previewable, from);
    // 단락이 연결되지 않은 근거는 미리볼 원문이 없다 — 본문 탭으로 돌아가 읽게 한다
    if (index >= 0) setOpen(index);
    else onBackToText();
  };
  return (
    <article className="sum-art" aria-labelledby="sum-art-title">
      <header className="sum-art__head">
        <p className="sum-art__kick">
          <Sparkles size={15} aria-hidden="true" />이 장의 AI 요약 · 약 {readingMinutes(item)}분
        </p>
        <h2 id="sum-art-title">{item.title}</h2>
        <p className="sum-art__sub">{item.lead}</p>
        <p className="sum-notice" role="note">
          <Info size={15} aria-hidden="true" />
          {AI_NOTICE}
        </p>
        {previewable.length > 0 && (
          <p className="sum-art__tip">
            <span className="sum-fn" aria-hidden="true">
              {unit}
            </span>
            번호를 누르면 근거 원문을 바로 볼 수 있어요.
          </p>
        )}
      </header>
      <InlineFigure image={concept} />
      <div className="sum-art__body">
        <SummaryBody body={item.body} assets={item.assets ?? []} onCite={onCite} />
      </div>
      <InlineFigure image={scene} />
      {item.key_points.length > 0 && (
        <aside className="sum-art__box" aria-labelledby="sum-art-points">
          <h3 id="sum-art-points">핵심 정리</h3>
          <ol>
            {item.key_points.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ol>
        </aside>
      )}
      {item.reflection_questions.length > 0 && (
        <section className="sum-art__ask" aria-labelledby="sum-art-ask">
          <h3 id="sum-art-ask">되새길 물음</h3>
          {item.reflection_questions.map((question, i) => (
            <p key={i}>{question}</p>
          ))}
        </section>
      )}
      {item.evidence.length > 0 && (
        <section className="sum-art__notes" aria-labelledby="sum-art-notes">
          <h3 id="sum-art-notes">근거 {unit}</h3>
          <ol>
            {item.evidence.map((evidence, i) => {
              const index = previewable.findIndex((p) => p.index === i);
              const label = `${unit} ${rangeLabel(evidence.from, evidence.to)}`;
              return (
                <li key={i}>
                  <p>{evidence.claim}</p>
                  {index >= 0 ? (
                    <button type="button" className="sum-art__cite" onClick={() => setOpen(index)}>
                      {label} 원문 보기 <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ) : (
                    <button type="button" className="sum-art__cite" onClick={onBackToText}>
                      {label} 본문에서 찾기 <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      <div className="sum-art__end">
        <button type="button" className="btn btn-line" onClick={onBackToText}>
          원문 이어 읽기
        </button>
        <Link className="btn btn-line" href={`/summaries/${item.id}`}>
          전체 요약 페이지
        </Link>
      </div>
      {open !== null && previewable[open] && (
        <EvidenceViewer
          wide={false}
          summaryId={item.id}
          volume={item.volume}
          unit={unit}
          evidence={previewable}
          index={open}
          onMove={setOpen}
          onClose={() => setOpen(null)}
          onOpenSource={(evidence) => {
            setOpen(null);
            onOpenSource(evidence);
          }}
        />
      )}
    </article>
  );
}

/** 공개 요약 하나를 불러와 글로 보인다. */
export function SummaryArticle({
  summaryId,
  onBackToText,
  onOpenSource,
}: {
  summaryId: string;
  onBackToText: () => void;
  onOpenSource: (evidence: PreviewableEvidence) => void;
}) {
  const query = useQuery({
    queryKey: aiSummaryKey(summaryId),
    queryFn: ({ signal }) => summariesAPI.detail(summaryId, signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
  if (query.isPending)
    return (
      <p className="sum-art__status" role="status">
        <BookOpenText size={18} aria-hidden="true" />
        요약을 불러오고 있어요
      </p>
    );
  if (query.isError || !query.data)
    return (
      <div className="sum-art__status" role="status">
        <p>요약을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.</p>
        <button type="button" className="btn btn-line btn--sm" onClick={() => void query.refetch()}>
          다시 시도
        </button>
      </div>
    );
  return <Article item={query.data} onBackToText={onBackToText} onOpenSource={onOpenSource} />;
}
