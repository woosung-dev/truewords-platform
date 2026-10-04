"use client";

// SCR-PWA-022 홈 "오늘의 책갈피" 카드 (PLAN-HD-012). 받기 전에는 책 이름만 공개하고 책 위로 리본 끝이 보인다.
// 대기 모션은 800ms 뒤 3초 주기 2회로 멈춘다(CSS, 동작 줄이기면 없음).
// 오늘 이미 받았으면 한 줄 행으로 줄인다 — 작은 책 + 책 이름 + "책갈피 다시 보기", 카드 전체가 링크다.
// 섹션 순서는 그대로 두고(PLAN-HD-005) 높이만 줄여 오늘의 실천이 첫 화면에 들어오게 한다.
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { CardPublic } from "../api";
import { useCardReceipt } from "../use-cards";
import { Book, bookName } from "./book";

export function BookmarkHomeCard({ card }: { card: CardPublic }) {
  // 기기에 받은 기록이 있으면 서버 목록을 기다리지 않고 바로 한 줄로 그린다 — 큰 카드가 떴다 줄어들지 않게
  const { isReceived } = useCardReceipt(card.id);
  return (
    <div className="sect bmhome-sect">
      <div className="sect__head">
        <h2 className="sect__title">오늘의 책갈피</h2>
      </div>
      {isReceived ? (
        <Link className="card bmhome bmhome--row" href="/hoondok/bookmark">
          <span className="bmhome__book">
            <Book card={card} size="sm" />
          </span>
          <span className="bmhome__bd">
            <b className="bmhome__title">{bookName(card)}</b>
            <span className="bmhome__meta">책갈피 다시 보기</span>
          </span>
          <ChevronRight className="bmhome__chev" size={20} aria-hidden="true" />
        </Link>
      ) : (
        <div className="card bmhome">
          <div className="bmhome__top">
            <div className="bmhome__book">
              <Book card={card} size="sm" isWaiting />
            </div>
            <div className="bmhome__bd">
              <span className="bmhome__kind">오늘 꽂혀 있는 책</span>
              <b className="bmhome__title">{bookName(card)}</b>
              <span className="bmhome__meta">한 장이 꽂혀 있어요. 꺼내면 오늘의 말씀이 펼쳐져요.</span>
            </div>
          </div>
          <Link className="btn btn-primary bmhome__go" href="/hoondok/bookmark">
            책갈피 꺼내기
          </Link>
        </div>
      )}
    </div>
  );
}
