"use client";

// SCR-PWA-026 나의 책갈피 (PLAN-HD-012, 시안 p4 책장·갤러리). 탭은 책장(받은) / 내 카드 갤러리(건넨, ?filter=shared).
// 책장: 책등 두께가 장수에 비례하고, 책등을 누르면 그 책의 카드가 부채꼴로 펼쳐진다(FanDialog). 위에는 "이번 달 모은 말씀" 진입점.
// 갤러리: 건넨 카드를 사진 카드 썸네일로 보이고, 누르면 이 기기에 남은 마지막 모양 그대로 건네기 시트가 열린다.
// 날짜 빈칸·연속일·열람 수는 없다(비처벌 원칙). 숫자는 서버 값만 쓴다.
import { Bookmark, LayoutGrid, RotateCcw } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useEffect, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { handleSegmentKeyDown } from "@/features/hoondok/segmented-keyboard";
import { formatKstMonthDay } from "@/features/hoondok/today";
import { useKstDate } from "@/features/hoondok/use-kst-date";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import type { CardPublic, CardReceiptItem, CardShelf, MyCardsFilter } from "../api";
import { bookColorIndex, COLLAGE_PHOTOS, defaultLook, photoSrc } from "../look";
import { cardPath } from "../share";
import { readCardLook } from "../storage";
import { useMarkShared, useMyCards, useSyncAnonReceipt } from "../use-cards";
import { type CollageOutcome, CollageSheet } from "./collage-sheet";
import { FanDialog } from "./fan-dialog";
import { PhotoCard } from "./photo-card";
import { isGivenOutcome, type ShareOutcome, ShareSheet, ShareToast, shareToastMessage } from "./share-sheet";

const TABS: { id: MyCardsFilter; label: string }[] = [
  { id: "received", label: "책장" },
  { id: "shared", label: "내 카드 갤러리" },
];
// 책등 높이는 책마다 조금씩 다르게 돌려 쓴다(시안 p4)
const SPINE_HEIGHTS = [212, 186, 200, 176, 206, 192];

function receivedLabel(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${month}월 ${day}일`;
}

/** 책등 두께: 가장 많이 모은 책 대비 장수에 비례(44~84px). 44px 은 누르는 자리 최소값이다 */
export function spineWidth(count: number, most: number): number {
  return 44 + Math.round((40 * count) / Math.max(1, most));
}

/** 건넨 시각(UTC) → KST "11월 3일" */
function sharedLabel(sharedAt: string | null): string | null {
  if (!sharedAt) return null;
  const date = new Date(sharedAt);
  return Number.isNaN(date.getTime()) ? null : formatKstMonthDay(date);
}

/** 건네기 시트 + 토스트 + 건넴 표시(050). 책장·갤러리가 같이 쓴다 */
function useShareFlow(userId: string) {
  const markShared = useMarkShared();
  const [card, setCard] = useState<CardPublic | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleDone(target: CardPublic, outcome: ShareOutcome) {
    if (isGivenOutcome(outcome) && userId) markShared.mutate(target.id);
    const message = shareToastMessage(outcome, Boolean(userId));
    if (message) setToast(message);
    if (outcome === "file" || outcome === "link") setCard(null);
  }
  const view = card ? (
    <ShareSheet
      card={card}
      onClose={() => setCard(null)}
      onDone={(outcome) => handleDone(card, outcome)}
      toast={<ShareToast message={toast} />}
    />
  ) : (
    <ShareToast message={toast} />
  );
  return { open: setCard, setToast, view };
}

function Shelf({ shelves, onOpen }: { shelves: CardShelf[]; onOpen: (title: string) => void }) {
  const most = Math.max(...shelves.map((shelf) => shelf.count));
  return (
    <div className="bks-shelf">
      <div className="bks-books">
        {shelves.map((shelf, index) => {
          const style = {
            width: spineWidth(shelf.count, most),
            height: SPINE_HEIGHTS[index % SPINE_HEIGHTS.length],
          } as CSSProperties;
          return (
            <button
              key={shelf.work_title}
              type="button"
              className={`bks-spine pc--book-${bookColorIndex(shelf.work_title)}`}
              style={style}
              aria-label={`${shelf.work_title}, 책갈피 ${shelf.count}장 펼치기`}
              onClick={() => onOpen(shelf.work_title)}
            >
              <span className="bks-spine__t">{shelf.work_title}</span>
              <span className="bks-spine__n">{shelf.count}</span>
            </button>
          );
        })}
      </div>
      <div className="bks-shelf__board" aria-hidden="true" />
    </div>
  );
}

function CardItem({ item }: { item: CardReceiptItem }) {
  return (
    <li>
      <Link className="bks-item" href={cardPath(item.card.id)}>
        <span className={`bks-item__rib pc--book-${bookColorIndex(item.card.work_title)}`} aria-hidden="true" />
        <span className="bks-item__bd">
          <span className="bks-item__q">{item.card.text}</span>
          <span className="bks-item__m">
            <span>{item.card.source_label}</span>
            <span>{receivedLabel(item.received_on)}</span>
            {item.shared_at && <span className="badge badge--accent">건넴</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

function CollageEntry({ month, count, onOpen }: { month: number; count: number; onOpen: () => void }) {
  return (
    <div className="bks-collage">
      <div className="bks-collage__top">
        <div className="bks-collage__bd">
          <span className="bks-collage__k">{month}월</span>
          <b>이번 달 모은 말씀</b>
          <p>{count}장을 한 장에 담아 건네요</p>
        </div>
        <span className="bks-collage__mosaic" aria-hidden="true">
          {COLLAGE_PHOTOS.map((photo) => (
            <img key={photo} src={photoSrc(photo)} alt="" />
          ))}
        </span>
      </div>
      <button className="pc-cta" type="button" onClick={onOpen}>
        한 장으로 만들기
        <span className="pc-cta__ic" aria-hidden="true">
          <LayoutGrid size={22} />
        </span>
      </button>
    </div>
  );
}

function PanelStatus({ query }: { query: ReturnType<typeof useMyCards> }) {
  if (query.isPending)
    return <span className="skeleton bks-skeleton" role="status" aria-busy="true" aria-label="책갈피를 불러오는 중" />;
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
}

function ShelfPanel({ userId }: { userId: string }) {
  const query = useMyCards("received", userId);
  const today = useKstDate();
  const share = useShareFlow(userId);
  const [fanTitle, setFanTitle] = useState<string | null>(null);
  const [isCollageOpen, setIsCollageOpen] = useState(false);

  if (!query.data) return <PanelStatus query={query} />;
  const { items, shelves } = query.data;
  if (items.length === 0)
    return (
      <div className="empty">
        <span className="empty__ic" aria-hidden="true">
          <Bookmark size={26} />
        </span>
        <p className="empty__title">아직 받은 책갈피가 없어요</p>
        <p className="empty__body">오늘 훈독 화면에서 책갈피를 꺼내 보세요.</p>
        <p className="gd-cta">
          <Link className="btn btn-line btn--sm" href="/bookmark">
            오늘의 책갈피
          </Link>
        </p>
      </div>
    );

  const month = Number(today.slice(5, 7));
  const monthItems = items.filter((item) => item.received_on.startsWith(today.slice(0, 7)));
  const fanItems = fanTitle ? items.filter((item) => item.card.work_title === fanTitle) : [];

  function handleCollageDone(outcome: CollageOutcome) {
    if (outcome === "file") {
      share.setToast("이번 달 모은 말씀을 건넸어요");
      setIsCollageOpen(false);
    }
  }

  return (
    <>
      {monthItems.length > 0 && (
        <CollageEntry month={month} count={monthItems.length} onOpen={() => setIsCollageOpen(true)} />
      )}
      <p className="bks-sum">
        <b>{items.length}</b>장 · {shelves.length}권의 책에서 받은 말씀
      </p>
      <Shelf shelves={shelves} onOpen={setFanTitle} />
      <p className="bks-hint">책을 누르면 모은 카드가 펼쳐져요</p>
      <div className="bks-list">
        <h2 className="bks-list__h">받은 책갈피 {items.length}장</h2>
        <ul>
          {items.map((item) => (
            <CardItem key={item.card.id} item={item} />
          ))}
        </ul>
      </div>
      {fanTitle && fanItems.length > 0 && (
        <FanDialog
          title={fanTitle}
          items={fanItems}
          onClose={() => setFanTitle(null)}
          onShare={(card) => {
            setFanTitle(null);
            share.open(card);
          }}
        />
      )}
      {isCollageOpen && (
        <CollageSheet
          items={monthItems}
          month={month}
          onClose={() => setIsCollageOpen(false)}
          onDone={handleCollageDone}
        />
      )}
      {share.view}
    </>
  );
}

function GalleryPanel({ userId }: { userId: string }) {
  const query = useMyCards("shared", userId);
  const share = useShareFlow(userId);

  if (!query.data) return <PanelStatus query={query} />;
  const { items } = query.data;
  if (items.length === 0)
    return (
      <div className="empty">
        <span className="empty__ic" aria-hidden="true">
          <Bookmark size={26} />
        </span>
        <p className="empty__title">아직 건넨 카드가 없어요</p>
        <p className="empty__body">사진 카드로 건네면 여기에 모두 남아 언제든 다시 건넬 수 있어요.</p>
        <p className="gd-cta">
          <Link className="btn btn-line btn--sm" href="/bookmark">
            오늘의 책갈피
          </Link>
        </p>
      </div>
    );

  return (
    <>
      <p className="bks-gal__intro">건넨 카드는 여기에 모두 남아요. 누르면 지난번 모양 그대로 다시 건넬 수 있어요.</p>
      <ul className="bks-gal">
        {items.map((item) => {
          const look = readCardLook(item.card.id) ?? defaultLook(item.card.id);
          const when = sharedLabel(item.shared_at);
          return (
            <li key={item.card.id}>
              <button
                type="button"
                className="bks-gal__item"
                aria-label={`${when ? `${when}에 건넨 카드` : "건넨 카드"}, 그대로 다시 건네기: ${item.card.text}`}
                onClick={() => share.open(item.card)}
              >
                <PhotoCard card={item.card} bg={look.bg} format={look.format} src={look.src} isDecorative />
                <span className="bks-gal__q" aria-hidden="true">
                  {item.card.text}
                </span>
                <span className="bks-gal__when" aria-hidden="true">
                  {when ?? "건넨 카드"}
                  <span className="bks-gal__again">
                    <RotateCcw size={16} />
                    다시 건네기
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {share.view}
    </>
  );
}

export function BookmarksScreen({ initialFilter }: { initialFilter: MyCardsFilter }) {
  const { user, isLoading } = useCurrentUser();
  // 비로그인으로 오늘 받은 책갈피가 있으면 로그인 뒤 여기서도 소급한다
  useSyncAnonReceipt();
  const [filter, setFilter] = useState<MyCardsFilter>(initialFilter);
  const shared = useMyCards("shared", user?.id ?? null);

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
            <p className="empty__body">책별로 꽂힌 책장과 건넨 카드 갤러리를 여기에서 볼 수 있어요.</p>
            <p className="gd-cta">
              <Link className="btn btn-primary" href={onboardingHref("/bookmarks")}>
                시작하기
              </Link>
            </p>
          </div>
        </div>
      </section>
    );

  const sharedCount = shared.data?.items.length;
  return (
    <section className="col bks">
      <p className="bks-lede">모은 말씀이 책마다 쌓여요. 많이 모을수록 책이 두꺼워져요.</p>
      <div className="bks-seg" role="tablist" onKeyDown={handleSegmentKeyDown} aria-label="책갈피 보기">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`bks-tab-${tab.id}`}
            aria-selected={filter === tab.id}
            tabIndex={filter === tab.id ? 0 : -1}
            aria-controls="bks-panel"
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
            {tab.id === "shared" && sharedCount !== undefined && sharedCount > 0 && (
              <span className="bks-seg__n">{sharedCount}</span>
            )}
          </button>
        ))}
      </div>
      <div id="bks-panel" role="tabpanel" aria-labelledby={`bks-tab-${filter}`}>
        {filter === "received" ? (
          <ShelfPanel key="received" userId={user.id} />
        ) : (
          <GalleryPanel key="shared" userId={user.id} />
        )}
      </div>
    </section>
  );
}
