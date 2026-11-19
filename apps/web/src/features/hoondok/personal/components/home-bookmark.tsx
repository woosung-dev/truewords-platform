"use client";

// 홈 "나의 책갈피" 맞춤 (기본값 10). 이 기기에 고른 답이 있으면 그 답에 맞춘 카드로 바꾸고 섹션 맨 아래에 까닭 한 줄과 "바꾸기"를 둔다.
// 답이 없으면 오늘 편성 카드 그대로에 "고르기" 줄만 붙인다. 받기 흐름은 BookmarkShelfHome 그대로다.
// 답은 기기 저장소에만 있어 서버·hydration 렌더에서는 어느 장인지 모른다. 그동안과 맞춘 장을 고르는 동안은 같은 높이의
// 자리(스켈레톤)만 그린다 — 오늘 편성 카드를 먼저 보였다가 다른 장으로 바꾸면 뽑기처럼 보이기 때문이다.
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { CardPublic } from "../../cards/api";
import { BookmarkShelfHome } from "../../cards/components/home-card";
import { FALLBACK_REASON, homeReason } from "../pick";
import { START_PATH } from "../start";
import { hasAnswers } from "../storage";
import { usePersonalAnswers, usePersonalCard } from "../use-personal";

export const INTERESTS_PATH = "/garden/interests";

/** 섹션 맨 아래 맞춤 줄. 문장과 동작 링크를 나눠 둔다 — 줄 전체를 링크로 묶으면 까닭 문장이 접근 이름에서 사라진다 */
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
    <div className="bmshelf__row bmshelf__why">
      <span className="bmshelf__row-ic" aria-hidden="true">
        <SlidersHorizontalIcon size={20} />
      </span>
      <p className="bmshelf__why-t">
        {text.split(/(‘[^’]+’)/).map((part, index) =>
          // biome-ignore lint/suspicious/noArrayIndexKey: 문장 조각은 순서가 곧 정체다
          part.startsWith("‘") ? <b key={index}>{part}</b> : <span key={index}>{part}</span>,
        )}
      </p>
      <Link className="bmshelf__why-go" href={href} aria-label={actionLabel}>
        {action}
      </Link>
    </div>
  );
}

const noopSubscribe = () => () => {};

/** 홈 책갈피 섹션과 같은 틀(제목 줄 · 책장 그림 자리 · 오늘 줄)의 정적 회색 자리. 모션 없음 */
function BookmarkHomeSkeleton() {
  return (
    <div className="sect bmshelf-sect">
      <div className="sect__head">
        <h2 className="sect__title">나의 책갈피</h2>
      </div>
      <div className="bmshelf" role="status" aria-busy="true" aria-label="나의 책갈피를 불러오는 중">
        <div className="bmshelf__core">
          <span className="bmshelf__scene" />
          <div className="bmshelf__body">
            <div className="bmshelf__today">
              <span className="bmshelf__skel" style={{ width: "70%" }} />
            </div>
            <div className="bmshelf__lite">
              <div className="bmshelf__row">
                <span className="bmshelf__skel" style={{ width: "85%" }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PickedHomeCard({ todayCard, dateLabel }: { todayCard: CardPublic | null; dateLabel: string }) {
  const state = usePersonalCard();
  if (state.status === "loading") return <BookmarkHomeSkeleton />;
  // 목록을 못 받으면 오늘 편성 카드를 그대로 둔다
  if (state.status === "error") return todayCard ? <BookmarkShelfHome card={todayCard} dateLabel={dateLabel} /> : null;
  if (!state.card) return null;
  const text = state.isFallback ? FALLBACK_REASON : homeReason(state.pick);
  return (
    <BookmarkShelfHome
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
  if (!isClient) return <BookmarkHomeSkeleton />;
  if (hasAnswers(answers)) return <PickedHomeCard todayCard={todayCard} dateLabel={dateLabel} />;
  if (!todayCard) return null;
  return (
    <BookmarkShelfHome
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
