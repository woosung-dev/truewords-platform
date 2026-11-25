"use client";

// 홈 "오늘의 책갈피" 판 맞춤 (기본값 10). 이 기기에 고른 답이 있으면 그 답에 맞춘 카드로 바꾸고 판 맨 아래에 까닭 한 줄과 "바꾸기"를 둔다.
// 답이 없으면 오늘의 카드 그대로에 "고르기" 줄만 붙인다. 꺼내기 흐름은 HomeBookmarkBoard 그대로다.
// 답은 기기 저장소에만 있어 서버·hydration 렌더에서는 어느 장인지 모른다. 그동안과 맞춘 장을 고르는 동안은 같은 높이의
// 자리(스켈레톤)만 그린다 — 오늘의 카드를 먼저 보였다가 다른 장으로 바꾸면 뽑기처럼 보이기 때문이다.
import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { SkySlot } from "@/features/hoondok/sky";
import type { CardPublic } from "../../cards/api";
import { HomeBoardFallback, HomeBoardSkeleton, HomeBookmarkBoard } from "../../cards/components/home-board";
import { FALLBACK_REASON, homeReason } from "../pick";
import { START_PATH } from "../start";
import { hasAnswers } from "../storage";
import { usePersonalAnswers, usePersonalCard } from "../use-personal";

export const INTERESTS_PATH = "/garden/interests";

/** 판 맨 아래 맞춤 줄. 문장과 동작 링크를 나눠 둔다 — 줄 전체를 링크로 묶으면 까닭 문장이 접근 이름에서 사라진다 */
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
    <>
      <p className="home-board__why">
        {text.split(/(‘[^’]+’)/).map((part, index) =>
          // biome-ignore lint/suspicious/noArrayIndexKey: 문장 조각은 순서가 곧 정체다
          part.startsWith("‘") ? <b key={index}>{part}</b> : <span key={index}>{part}</span>,
        )}
      </p>
      <Link className="home-board__tlink" href={href} aria-label={actionLabel}>
        {action}
      </Link>
    </>
  );
}

const noopSubscribe = () => () => {};

function PickedHomeCard({
  todayCard,
  dateLabel,
  serverSlot,
}: {
  todayCard: CardPublic | null;
  dateLabel: string;
  serverSlot: SkySlot;
}) {
  const state = usePersonalCard();
  if (state.status === "loading") return <HomeBoardSkeleton serverSlot={serverSlot} />;
  // 목록을 못 받으면 오늘의 카드를 그대로 둔다
  if (state.status === "error")
    return todayCard ? (
      <HomeBookmarkBoard key={todayCard.id} card={todayCard} dateLabel={dateLabel} serverSlot={serverSlot} />
    ) : (
      <HomeBoardFallback serverSlot={serverSlot} />
    );
  if (!state.card) return <HomeBoardFallback serverSlot={serverSlot} />;
  const text = state.isFallback ? FALLBACK_REASON : homeReason(state.pick);
  return (
    <HomeBookmarkBoard
      key={state.card.id}
      card={state.card}
      dateLabel={dateLabel}
      serverSlot={serverSlot}
      footer={<ReasonLine text={text} href={INTERESTS_PATH} action="바꾸기" actionLabel="관심사와 마음 바꾸기" />}
    />
  );
}

export function PersonalBookmarkHome({
  todayCard,
  dateLabel,
  serverSlot,
}: {
  todayCard: CardPublic | null;
  dateLabel: string;
  serverSlot: SkySlot;
}) {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const { answers } = usePersonalAnswers();
  if (!isClient) return <HomeBoardSkeleton serverSlot={serverSlot} />;
  if (hasAnswers(answers))
    return <PickedHomeCard todayCard={todayCard} dateLabel={dateLabel} serverSlot={serverSlot} />;
  if (!todayCard) return <HomeBoardFallback serverSlot={serverSlot} />;
  return (
    <HomeBookmarkBoard
      key={todayCard.id}
      card={todayCard}
      dateLabel={dateLabel}
      serverSlot={serverSlot}
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
