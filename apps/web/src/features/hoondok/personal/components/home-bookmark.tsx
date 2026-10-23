"use client";

// 홈 "오늘의 책갈피" 맞춤 (기본값 10). 이 기기에 고른 답이 있으면 그 답에 맞춘 카드로 바꾸고 카드 아래에 까닭 한 줄과 "바꾸기"를 둔다.
// 답이 없으면 오늘 편성 카드 그대로에 "고르기" 줄만 붙인다. 받기 흐름·모션은 BookmarkHomeCard 그대로다.
// 답은 기기 저장소에만 있어 서버·hydration 렌더에서는 어느 장인지 모른다. 그동안과 맞춘 장을 고르는 동안은 같은 높이의
// 자리(스켈레톤)만 그린다 — 오늘 편성 카드를 먼저 보였다가 다른 장으로 바꾸면 뽑기처럼 보이기 때문이다.
import { Info } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
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

const noopSubscribe = () => () => {};

/** 홈 책갈피 카드와 같은 틀(제목 줄 · 책 자리 · 글 자리 · 버튼 자리 · 한 줄)의 정적 회색 자리. 모션 없음 */
function BookmarkHomeSkeleton({ dateLabel }: { dateLabel: string }) {
  return (
    <div className="sect bmhome-sect">
      <div className="sect__head">
        <h2 className="sect__title">오늘의 책갈피</h2>
        <span className="sect__meta">{dateLabel}</span>
      </div>
      <div className="card bmhome ps-skel" role="status" aria-busy="true" aria-label="오늘의 책갈피를 불러오는 중">
        <div className="bmhome__top">
          <span className="skeleton ps-skel__book" />
          <div className="bmhome__bd ps-skel__bd">
            <span className="skeleton ps-skel__line" style={{ width: "40%" }} />
            <span className="skeleton ps-skel__line ps-skel__line--lg" style={{ width: "70%" }} />
            <span className="skeleton ps-skel__line" style={{ width: "90%" }} />
          </div>
        </div>
        <span className="skeleton ps-skel__btn bmhome__go" />
        <span className="skeleton ps-skel__line ps-skel__why" style={{ width: "75%" }} />
      </div>
    </div>
  );
}

function PickedHomeCard({ todayCard, dateLabel }: { todayCard: CardPublic | null; dateLabel: string }) {
  const state = usePersonalCard();
  if (state.status === "loading") return <BookmarkHomeSkeleton dateLabel={dateLabel} />;
  // 목록을 못 받으면 오늘 편성 카드를 그대로 둔다
  if (state.status === "error") return todayCard ? <BookmarkHomeCard card={todayCard} dateLabel={dateLabel} /> : null;
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
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const { answers } = usePersonalAnswers();
  if (!isClient) return <BookmarkHomeSkeleton dateLabel={dateLabel} />;
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
