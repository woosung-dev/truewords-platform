"use client";

// 원문 뷰 "AI 설명" 탭 (SCR-PWA-009). 지금 장에 공개된 AI 요약이 있으면 그 요약을 한 편의 글로 먼저 보이고,
// 고른 단락만 묻는 실시간 설명(AiExplain)은 그 아래 보조로 둔다. 공개 요약이 없으면 지금처럼 단락 질문만 보인다.
import dynamic from "next/dynamic";
import { type ReactNode, useState } from "react";
import type { PreviewableEvidence } from "../../summaries/evidence-viewer";

const SummaryArticle = dynamic(
  () => import("../../summaries/summary-article").then((module) => module.SummaryArticle),
  { loading: () => <p role="status">요약을 불러오고 있어요</p> },
);

export function AiSegment({
  summaries,
  explain,
  onBackToText,
  onOpenSource,
}: {
  /** 지금 장의 공개 요약(목록 순서) */
  summaries: { id: string; title: string }[];
  /** 고른 단락 질문 UI — 요약이 없으면 이것만, 있으면 글 아래 보조로 */
  explain: ReactNode;
  onBackToText: () => void;
  onOpenSource: (evidence: PreviewableEvidence) => void;
}) {
  const [picked, setPicked] = useState(0);
  if (!summaries.length) return <>{explain}</>;
  const current = summaries[Math.min(picked, summaries.length - 1)];
  return (
    <div className="ai-seg">
      {summaries.length > 1 && (
        <div className="sum-art__pick" role="group" aria-label={`이 장의 AI 요약 ${summaries.length}개`}>
          {summaries.map((item, i) => (
            <button key={item.id} type="button" aria-pressed={item.id === current.id} onClick={() => setPicked(i)}>
              {item.title}
            </button>
          ))}
        </div>
      )}
      <SummaryArticle
        key={current.id}
        summaryId={current.id}
        onBackToText={onBackToText}
        onOpenSource={onOpenSource}
      />
      <section className="sum-art__more" aria-labelledby="ai-seg-more">
        <h3 id="ai-seg-more">고른 단락만 AI에게 묻기</h3>
        {explain}
      </section>
    </div>
  );
}
