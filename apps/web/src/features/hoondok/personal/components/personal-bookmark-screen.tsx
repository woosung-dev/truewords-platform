"use client";

// /hoondok/bookmark 맞춤. 홈 카드와 같은 장을 받도록 이 기기에 답이 있으면 맞춘 카드로 받기 화면을 연다.
// 받기 API(049)는 아무 active 카드나 받으므로 서버 변경이 없다. 고르기가 끝나기 전에는 받기 화면을 그리지 않는다 —
// 오늘 편성 카드로 먼저 열리면 그 카드를 받은 것으로 기록하고 모션이 두 번 돈다.
import { type ReactNode, useSyncExternalStore } from "react";
import type { CardPublic } from "../../cards/api";
import { BookmarkScreen } from "../../cards/components/bookmark-screen";
import { hasAnswers } from "../storage";
import { usePersonalAnswers, usePersonalCard } from "../use-personal";

type Props = { todayCard: CardPublic | null; today: string; from?: string; empty: ReactNode };

const noopSubscribe = () => () => {};

/** 어느 장인지 정하기 전의 자리. 책갈피 카드(bm--full)와 같은 비율의 정적 회색 자리만 둔다 */
function Waiting() {
  return (
    <section className="col" role="status" aria-busy="true" aria-label="오늘의 책갈피를 불러오는 중">
      <span className="skeleton bm--full" />
    </section>
  );
}

function Screen({ card, today, from, empty }: Omit<Props, "todayCard"> & { card: CardPublic | null }) {
  if (!card) return <>{empty}</>;
  // 날짜나 카드가 바뀌면 화면 상태를 새로 시작한다
  return <BookmarkScreen key={`${today}:${card.id}`} card={card} today={today} from={from} />;
}

function PickedScreen({ todayCard, ...rest }: Props) {
  const state = usePersonalCard();
  if (state.status === "loading") return <Waiting />;
  // 목록을 못 받으면 오늘 편성 카드로 받는다
  return <Screen card={state.status === "ready" ? state.card : todayCard} {...rest} />;
}

export function PersonalBookmarkScreen({ todayCard, ...rest }: Props) {
  // 서버·hydration 렌더에는 기기 저장소가 없다. 클라이언트에서 답을 읽은 뒤에만 어느 카드인지 정한다.
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const { answers } = usePersonalAnswers();
  if (!isClient) return <Waiting />;
  if (hasAnswers(answers)) return <PickedScreen todayCard={todayCard} {...rest} />;
  return <Screen card={todayCard} {...rest} />;
}
