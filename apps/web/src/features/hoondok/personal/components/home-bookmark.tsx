"use client";

// 홈 "오늘의 책갈피" 맞춤 (기본값 10). 이 기기에 고른 답이 있으면 그 답에 맞춘 카드로 바꾸고 카드 아래에 까닭 한 줄과 "바꾸기"를 둔다.
// 답이 없으면 오늘 편성 카드 그대로에 "고르기" 줄만 붙인다. 받기 흐름·모션은 BookmarkHomeCard 그대로다.
// 답은 기기 저장소에만 있어 서버 렌더는 늘 "답 없음"이다. 첫 렌더 뒤에 맞춘 카드로 바뀐다.
import { Info } from "lucide-react";
import Link from "next/link";
import type { CardPublic } from "../../cards/api";
import { BookmarkHomeCard } from "../../cards/components/home-card";
import { FALLBACK_REASON, homeReason } from "../pick";
import { START_PATH } from "../start";
import { hasAnswers } from "../storage";
import { usePersonalAnswers, usePersonalCard } from "../use-personal";

export const INTERESTS_PATH = "/hoondok/garden/interests";

function ReasonLine({
  text,
  href,
  action,
  actionLabel,
}: {
  text: string;
  href: string;
  action: string;
  actionLabel: string;
}) {
  return (
    <div className="ps-why">
      <Info size={20} aria-hidden="true" />
      <p className="ps-why__t">
        {text.split(/(‘[^’]+’)/).map((part, index) =>
          // biome-ignore lint/suspicious/noArrayIndexKey: 문장 조각은 순서가 곧 정체다
          part.startsWith("‘") ? <b key={index}>{part}</b> : <span key={index}>{part}</span>,
        )}
      </p>
      <Link className="ps-why__go" href={href} aria-label={actionLabel}>
        {action}
      </Link>
    </div>
  );
}

function PickedHomeCard({ todayCard, dateLabel }: { todayCard: CardPublic | null; dateLabel: string }) {
  const state = usePersonalCard();
  // 고르는 중·못 받음에는 오늘 편성 카드를 그대로 둔다(빈 자리로 튀지 않게)
  if (state.status !== "ready") return todayCard ? <BookmarkHomeCard card={todayCard} dateLabel={dateLabel} /> : null;
  if (!state.card) return null;
  const text = state.isFallback ? FALLBACK_REASON : homeReason(state.pick);
  return (
    <BookmarkHomeCard
      card={state.card}
      dateLabel={dateLabel}
      footer={<ReasonLine text={text} href={INTERESTS_PATH} action="바꾸기" actionLabel="관심사와 마음 바꾸기" />}
    />
  );
}

export function PersonalBookmarkHome({ todayCard, dateLabel }: { todayCard: CardPublic | null; dateLabel: string }) {
  const { answers } = usePersonalAnswers();
  if (hasAnswers(answers)) return <PickedHomeCard todayCard={todayCard} dateLabel={dateLabel} />;
  if (!todayCard) return null;
  return (
    <BookmarkHomeCard
      card={todayCard}
      dateLabel={dateLabel}
      footer={
        <ReasonLine
          text="관심 주제를 고르면 맞춘 장이 꽂혀요"
          href={START_PATH}
          action="고르기"
          actionLabel="관심 주제 고르기"
        />
      }
    />
  );
}
