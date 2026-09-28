"use client";

// SCR-PWA-022 홈 "오늘의 책갈피" 카드 (PLAN-HD-012). 받기 전에는 책 이름만 공개하고 책 위로 리본 끝이 보인다.
// 대기 모션은 800ms 뒤 3초 주기 2회로 멈춘다(CSS, 동작 줄이기면 없음). 오늘 이미 받았으면 "다시 보기" 로 바뀐다.
import Link from "next/link";
import type { CardPublic } from "../api";
import { useCardReceipt } from "../use-cards";
import { Book, bookName } from "./book";

export function BookmarkHomeCard({ card, dateLabel }: { card: CardPublic; dateLabel: string }) {
  const { isReceived, isResolved } = useCardReceipt(card.id);
  const isShownReceived = isResolved && isReceived;
  return (
    <div className="sect bmhome-sect">
      <div className="sect__head">
        <h2 className="sect__title">오늘의 책갈피</h2>
        <span className="sect__meta">{dateLabel}</span>
      </div>
      <div className="card bmhome">
        <div className="bmhome__top">
          <div className="bmhome__book">
            <Book card={card} size="sm" isWaiting={!isShownReceived} />
          </div>
          <div className="bmhome__bd">
            <span className="bmhome__kind">{isShownReceived ? "오늘 꺼낸 책" : "오늘 꽂혀 있는 책"}</span>
            <b className="bmhome__title">{bookName(card)}</b>
            <span className="bmhome__meta">
              {isShownReceived
                ? "오늘의 말씀을 다시 펼쳐 볼 수 있어요."
                : "한 장이 꽂혀 있어요. 꺼내면 오늘의 말씀이 펼쳐져요."}
            </span>
          </div>
        </div>
        <Link className={`btn ${isShownReceived ? "btn-line" : "btn-primary"} bmhome__go`} href="/hoondok/bookmark">
          {isShownReceived ? "책갈피 다시 보기" : "책갈피 꺼내기"}
        </Link>
      </div>
    </div>
  );
}
