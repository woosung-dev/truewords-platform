"use client";

// SCR-PWA-022 홈 "오늘의 책갈피" 카드 (PLAN-HD-012, 시안 p4 홈). 받기 전에는 책 이름만 공개하고 짙은 바탕 위로 금색 리본이 보인다.
// 리본은 800ms 뒤 2회만 살짝 내려왔다 멈춘다(CSS, 동작 줄이기면 없음). 오늘 이미 받았으면 "다시 보기" 로 바뀐다.
// 로그인 사용자에게만 아래 타일 두 개(나의 책갈피 N장 · 내 카드 갤러리 N장)를 보인다. 숫자는 서버 값만 쓰고 읽기 전에는 비운다.
import { BookOpen } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCurrentUser } from "@/features/identity/use-current-user";
import type { CardPublic } from "../api";
import { bookColorIndex } from "../look";
import { useCardReceipt, useMyCards } from "../use-cards";
import { bookName } from "./book";

/** 타일 숫자는 서버 목록을 읽은 뒤에만 보인다. 읽는 중·실패면 숫자 없이 둔다 */
function HomeTiles({ userId }: { userId: string }) {
  const received = useMyCards("received", userId);
  const shared = useMyCards("shared", userId);
  const receivedCount = received.data ? received.data.items.length : null;
  const sharedCount = shared.data ? shared.data.items.length : null;
  const shelves = received.data?.shelves.slice(0, 4) ?? [];
  const most = Math.max(1, ...shelves.map((shelf) => shelf.count));
  return (
    <div className="bmhome-tiles">
      <Link className="bmhome-tile" href="/bookmarks">
        <span className="bmhome-tile__spines" aria-hidden="true">
          {shelves.map((shelf, index) => (
            <i
              key={shelf.work_title}
              className={`pc--book-${bookColorIndex(shelf.work_title)}`}
              style={{ width: 8 + Math.round((shelf.count / most) * 10), height: [40, 32, 36, 28][index] }}
            />
          ))}
        </span>
        <span className="bmhome-tile__bd">
          <b>나의 책갈피</b>
          {receivedCount !== null && <span>{receivedCount}장</span>}
        </span>
      </Link>
      <Link className="bmhome-tile" href="/bookmarks?filter=shared">
        <span className="bmhome-tile__num" aria-hidden={sharedCount === null}>
          {sharedCount ?? ""}
        </span>
        <span className="bmhome-tile__bd">
          <b>내 카드 갤러리</b>
          <span>{sharedCount === null ? "건넨 카드" : `건넨 카드 ${sharedCount}장`}</span>
        </span>
      </Link>
    </div>
  );
}

export function BookmarkHomeCard({
  card,
  dateLabel,
  footer,
}: {
  card: CardPublic;
  dateLabel: string;
  /** 카드 맨 아래 한 줄(맞춤 까닭·고르기). 없으면 그리지 않는다 */
  footer?: ReactNode;
}) {
  const { isReceived, isResolved } = useCardReceipt(card.id);
  const { user } = useCurrentUser();
  const isShownReceived = isResolved && isReceived;
  const book = bookName(card);
  return (
    <div className="sect bmhome-sect">
      <div className="sect__head">
        <h2 className="sect__title">오늘의 책갈피</h2>
        <span className="sect__meta">{dateLabel}</span>
      </div>
      <div className="card bmhome">
        <div className={`bmhome__env${isShownReceived ? "" : " is-waiting"}`}>
          <span className="bmhome__rib" aria-hidden="true" />
          <span className="bmhome__kind">{book}</span>
          <p className="bmhome__title">
            {isShownReceived
              ? `오늘 ${book}에서 꺼낸 말씀을 다시 펼쳐 볼 수 있어요`
              : `오늘 ${book}에 책갈피가 한 장 꽂혀 있어요`}
          </p>
          <Link className={`pc-cta ${isShownReceived ? "pc-cta--light" : "pc-cta--gold"} bmhome__go`} href="/bookmark">
            {isShownReceived ? "책갈피 다시 보기" : "책갈피 꺼내기"}
            <span className="pc-cta__ic" aria-hidden="true">
              <BookOpen size={22} />
            </span>
          </Link>
        </div>
        {footer}
      </div>
      {user && <HomeTiles userId={user.id} />}
    </div>
  );
}
