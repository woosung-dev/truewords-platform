"use client";

// SCR-PWA-026 나의 책갈피 (PLAN-HD-012, 시안 ⑨). 가로 글씨 책장(권별 개수 막대) + 목록, 탭은 받은 / 건넨.
// 날짜 빈칸·연속일·열람 수는 없다(비처벌 원칙). 책등을 누르면 그 책의 책갈피만, 다시 누르면 전체.
import { Bookmark } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import type { CardReceiptItem, CardShelf, MyCardsFilter } from "../api";
import { cardPath } from "../share";
import { useMyCards } from "../use-cards";

// 책등 색·길이·들여쓰기 (시안 LAY). 책 이름 순서대로 돌려 쓴다.
// 책등 아래 리본 꼬리는 최대 6개 (시안)
const TAILS = ["a", "b", "c", "d", "e", "f"] as const;
const SPINES = 9;
const LAYOUT: readonly [string, string][] = [
  ["100%", "0"],
  ["94%", "3%"],
  ["97%", "1%"],
  ["92%", "5%"],
  ["99%", "0"],
  ["95%", "2%"],
  ["98%", "1%"],
  ["93%", "4%"],
  ["96%", "2%"],
];
const TABS: { id: MyCardsFilter; label: string }[] = [
  { id: "received", label: "받은 책갈피" },
  { id: "shared", label: "건넨 책갈피" },
];

function receivedLabel(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${month}월 ${day}일`;
}

function Shelf({
  shelves,
  selected,
  onSelect,
}: {
  shelves: CardShelf[];
  selected: string | null;
  onSelect: (title: string | null) => void;
}) {
  return (
    <div className="bks-shelf">
      <div className="bks-shelf__stack">
        {shelves.map((shelf, index) => {
          const [width, indent] = LAYOUT[index % LAYOUT.length];
          const isOn = selected === shelf.work_title;
          return (
            <button
              key={shelf.work_title}
              type="button"
              className={`bks-spine bks-spine--${(index % SPINES) + 1}`}
              style={{ width, marginLeft: indent }}
              aria-pressed={isOn}
              aria-label={`${shelf.work_title}, 책갈피 ${shelf.count}장`}
              onClick={() => onSelect(isOn ? null : shelf.work_title)}
            >
              <span className="bks-spine__t">{shelf.work_title}</span>
              <span className="bks-spine__n">{shelf.count}장</span>
              <span className="bks-spine__tails" aria-hidden="true">
                {TAILS.slice(0, Math.min(shelf.count, TAILS.length)).map((tail) => (
                  <i key={tail} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="bks-shelf__board" aria-hidden="true" />
    </div>
  );
}

function CardItem({ item, isSharedTab }: { item: CardReceiptItem; isSharedTab: boolean }) {
  return (
    <li>
      <Link className="bks-item" href={cardPath(item.card.id)}>
        <span className="bks-item__rib" aria-hidden="true" />
        <span className="bks-item__bd">
          <span className="bks-item__q">{item.card.text}</span>
          <span className="bks-item__m">
            <span>{item.card.source_label}</span>
            <span>{receivedLabel(item.received_on)}</span>
            {item.shared_at && !isSharedTab && <span className="badge badge--accent">건넴</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Panel({ filter, userId }: { filter: MyCardsFilter; userId: string }) {
  const query = useMyCards(filter, userId);
  const [selected, setSelected] = useState<string | null>(null);

  if (query.isPending)
    return <span className="skeleton bks-skeleton" role="status" aria-busy="true" aria-label="책갈피를 불러오는 중" />;
  if (query.isError)
    return (
      <div className="empty" role="status">
        <p className="empty__title">책갈피를 불러오지 못했어요</p>
        <p className="gd-cta">
          <HoondokButton variant="line" isSmall onClick={() => void query.refetch()}>
            다시 시도
          </HoondokButton>
        </p>
      </div>
    );

  const { items, shelves } = query.data;
  if (items.length === 0)
    return (
      <div className="empty">
        <span className="empty__ic" aria-hidden="true">
          <Bookmark size={26} />
        </span>
        <p className="empty__title">
          {filter === "shared" ? "아직 건넨 책갈피가 없어요" : "아직 받은 책갈피가 없어요"}
        </p>
        <p className="empty__body">
          {filter === "shared"
            ? "책갈피를 가족·식구에게 건네면 여기에 남아요."
            : "오늘 훈독 화면에서 책갈피를 꺼내 보세요."}
        </p>
        <p className="gd-cta">
          <Link className="btn btn-line btn--sm" href="/hoondok/bookmark">
            오늘의 책갈피
          </Link>
        </p>
      </div>
    );

  const visible = selected ? items.filter((item) => item.card.work_title === selected) : items;
  const noun = filter === "shared" ? "건넨" : "받은";
  return (
    <>
      <p className="bks-sum">
        <b>{items.length}</b>장 · {shelves.length}권의 책에서 {noun} 말씀
      </p>
      <Shelf shelves={shelves} selected={selected} onSelect={setSelected} />
      <div className="bks-list">
        <h2 className="bks-list__h">
          {selected ? `${selected}에서 ${noun} 책갈피` : `${noun} 책갈피`} {visible.length}장
        </h2>
        <ul>
          {visible.map((item) => (
            <CardItem key={item.card.id} item={item} isSharedTab={filter === "shared"} />
          ))}
        </ul>
      </div>
    </>
  );
}

export function BookmarksScreen({ initialFilter }: { initialFilter: MyCardsFilter }) {
  const { user, isLoading } = useCurrentUser();
  const [filter, setFilter] = useState<MyCardsFilter>(initialFilter);

  if (isLoading)
    return (
      <section className="col">
        <span className="skeleton bks-skeleton" role="status" aria-busy="true" aria-label="불러오는 중" />
      </section>
    );

  if (!user)
    return (
      <section className="col">
        <div className="card">
          <div className="empty">
            <span className="empty__ic" aria-hidden="true">
              <Bookmark size={28} />
            </span>
            <h2 className="empty__title">로그인하면 받은 책갈피가 모여요</h2>
            <p className="empty__body">책별로 꽂힌 책장과 건넨 책갈피를 여기에서 볼 수 있어요.</p>
            <p className="gd-cta">
              <Link className="btn btn-primary" href={onboardingHref("/hoondok/bookmarks")}>
                시작하기
              </Link>
            </p>
          </div>
        </div>
      </section>
    );

  return (
    <section className="col bks">
      <div className="bks-seg" role="tablist" aria-label="책갈피 보기">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`bks-tab-${tab.id}`}
            aria-selected={filter === tab.id}
            aria-controls="bks-panel"
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div id="bks-panel" role="tabpanel" aria-labelledby={`bks-tab-${filter}`}>
        <Panel key={filter} filter={filter} userId={user.id} />
      </div>
    </section>
  );
}
