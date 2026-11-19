"use client";

// SCR-PWA-022 홈 "나의 책갈피" 섹션. 매일 한 장씩 꽂히는 책장 그림(2순위) — 오늘 할 일은 위 "오늘 읽을 말씀" 판이 맡는다.
// 받기 전에는 책 이름만 공개하고(본문·출처는 DOM 에 넣지 않는다) 받은 뒤에는 본문 한 줄과 출처로 "다시 보기" 를 둔다.
// 장수·책등·범례·건넨 장수는 로그인 사용자의 서버 값만 쓰고, 읽기 전·실패·비로그인이면 점선 빈 책등과 숫자 없는 문구다.
// 채운 주황·금색 버튼과 남색 밤 판은 쓰지 않는다(채운 주 버튼은 홈에 주인공 하나뿐).
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { CardsIcon } from "@phosphor-icons/react/dist/ssr/Cards";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import Link from "next/link";
import type { ReactNode } from "react";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import type { CardPublic, CardShelf } from "../api";
import { bookColorIndex } from "../look";
import { useCardReceipt, useMyCards } from "../use-cards";
import { bookName } from "./book";

/** 그림에 세우는 책등 상한(375px 폭 한 줄). 실제 장수는 제목 옆 숫자와 범례가 말한다 */
const MAX_SPINES = 12;
/** 책등 높이(px) 순환 — 같은 장수면 늘 같은 그림이다 */
const SPINE_HEIGHTS = [84, 90, 78, 92, 86, 96, 88, 80];
const GHOST_SPINES = [78, 86, 72, 90, 80];

/** 권별 색 책등. shelves(개수 내림차순) 순서로 상한까지 세우고, 권이 바뀌는 자리에 틈을 둔다 */
function Spines({ shelves }: { shelves: CardShelf[] | null }) {
  if (!shelves || shelves.length === 0)
    return (
      <span className="bmshelf__spines">
        {GHOST_SPINES.map((height, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 고정 장식 목록이다
          <i key={index} className="bmshelf__spine is-ghost" style={{ height }} />
        ))}
      </span>
    );
  const spines: { key: string; book: number; isGap: boolean }[] = [];
  for (const shelf of shelves) {
    for (let index = 0; index < shelf.count && spines.length < MAX_SPINES; index += 1)
      spines.push({
        key: `${shelf.work_title}-${index}`,
        book: bookColorIndex(shelf.work_title),
        isGap: index === 0 && spines.length > 0,
      });
  }
  return (
    <span className="bmshelf__spines">
      {spines.map((spine, index) => (
        <i
          key={spine.key}
          className={`bmshelf__spine pc--book-${spine.book}${spine.isGap ? " is-gap" : ""}`}
          style={{ height: SPINE_HEIGHTS[index % SPINE_HEIGHTS.length] }}
        />
      ))}
    </span>
  );
}

/** 회색 바탕 보조 버튼 + 원형 꼬리 */
function PullLink({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  return (
    <Link className="bmshelf__pull" href={href}>
      {label}
      <span className="bmshelf__nub" aria-hidden="true">
        {icon}
      </span>
    </Link>
  );
}

export function BookmarkShelfHome({
  card,
  dateLabel,
  footer,
}: {
  card: CardPublic;
  dateLabel: string;
  /** 섹션 맨 아래 맞춤 줄(까닭·바꾸기 또는 고르기). 없으면 그리지 않는다 */
  footer?: ReactNode;
}) {
  const { isReceived, isResolved } = useCardReceipt(card.id);
  const { user } = useCurrentUser();
  const userId = user?.id ?? null;
  // useCardReceipt 와 같은 쿼리 키라 받은 목록은 한 번만 부른다
  const received = useMyCards("received", userId);
  const shared = useMyCards("shared", userId);
  const isShownReceived = isResolved && isReceived;
  const isGuest = isResolved && !user;
  const shelves = user ? (received.data?.shelves ?? null) : null;
  const receivedCount = user && received.data ? received.data.items.length : null;
  const sharedCount = shared.data ? shared.data.items.length : null;

  const scene = (
    <>
      <Spines shelves={shelves} />
      <span className={`bmshelf__new${isShownReceived ? " is-out" : ""}`}>
        <span className="bmshelf__rib" />
        <span className="bmshelf__leaf" />
      </span>
      <span className="bmshelf__plank" />
      {isResolved && <span className="bmshelf__tag">{isShownReceived ? "오늘 꺼냄" : "새 장"}</span>}
    </>
  );

  return (
    <div className="sect bmshelf-sect">
      <div className="sect__head">
        <h2 className="sect__title">나의 책갈피</h2>
        {receivedCount !== null && <span className="sect__meta">{receivedCount}장</span>}
      </div>
      <div className="bmshelf">
        <div className="bmshelf__core">
          {user ? (
            <Link className="bmshelf__scene" href="/bookmarks" aria-label="나의 책갈피 책장 보기">
              {scene}
            </Link>
          ) : (
            <div className="bmshelf__scene" aria-hidden="true">
              {scene}
            </div>
          )}
          <div className="bmshelf__body">
            {shelves && shelves.length > 0 && (
              <p className="bmshelf__legend">
                {shelves.map((shelf) => `${shelf.work_title} ${shelf.count}`).join(" · ")}
              </p>
            )}
            {isShownReceived ? (
              <div className="bmshelf__today">
                <div className="bmshelf__today-tx">
                  <p className="bmshelf__quote">“{card.text}”</p>
                  <p className="bmshelf__sub">{card.source_label}</p>
                </div>
                <PullLink href="/bookmark" label="다시 보기" icon={<ArrowRightIcon size={18} />} />
              </div>
            ) : isGuest ? (
              <div className="bmshelf__today">
                <div className="bmshelf__today-tx">
                  <p className="bmshelf__title">매일 한 장씩 꽂혀요</p>
                  <p className="bmshelf__sub">로그인하면 모아 둘 수 있어요</p>
                </div>
              </div>
            ) : (
              <div className="bmshelf__today">
                <div className="bmshelf__today-tx">
                  <p className="bmshelf__title">새 장이 한 장 꽂혔어요</p>
                  <p className="bmshelf__sub">
                    {bookName(card)} · {dateLabel}
                  </p>
                </div>
                <PullLink href="/bookmark" label="꺼내기" icon={<ArrowUpIcon size={18} />} />
              </div>
            )}
            {/* 비로그인: 오늘 한 장 보기 + 로그인. 이 기기에서 이미 받았으면 다시 보기 줄이 먼저고 로그인만 남긴다 */}
            {isResolved && !user && (
              <div className="bmshelf__login">
                {!isShownReceived && (
                  <PullLink href="/bookmark" label="오늘 한 장 보기" icon={<ArrowUpIcon size={18} />} />
                )}
                <Link className="bmshelf__text-link" href={onboardingHref("/")}>
                  로그인
                </Link>
              </div>
            )}
            {(user || footer) && (
              <div className="bmshelf__lite">
                {user && (
                  <Link className="bmshelf__row" href="/bookmarks?filter=shared">
                    <span className="bmshelf__row-ic" aria-hidden="true">
                      <CardsIcon size={20} />
                    </span>
                    <span className="bmshelf__row-t">
                      내 카드 갤러리
                      <span className="bmshelf__row-s">
                        {sharedCount === null ? "건넨 카드" : `건넨 카드 ${sharedCount}장`}
                      </span>
                    </span>
                    <CaretRightIcon className="bmshelf__chev" size={20} aria-hidden="true" />
                  </Link>
                )}
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
