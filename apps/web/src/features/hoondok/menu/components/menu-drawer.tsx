"use client";

// 전체 메뉴 (앱바 햄버거). 밀리의 서재 "즐겨찾기" 패널을 참고했다 — 위 띠에 즐겨찾기 칩 두 묶음(메뉴·말씀)과 초기화,
// 아래에 탭 두 개(메뉴·말씀)와 별 토글 목록. 배경막·포커스 가둠·Esc 는 <dialog>.showModal() 이 맡는다(정성 시트와 같다).
import { useQuery } from "@tanstack/react-query";
import type { LibraryWork } from "@truewords/api-client-ts/types";
import { RotateCcw, Star, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { libraryAPI, seriesHref } from "@/features/hoondok/library/api";
import { LIBRARY_KEY } from "@/features/hoondok/query-keys";
import {
  type Favorites,
  readFavorites,
  toggleMenuFavorite,
  toggleWorkFavorite,
  useFavorites,
  writeFavorites,
} from "../favorites";
import { availableMenuItem, MENU_GROUPS, type MenuItem } from "../items";

type TabId = "menu" | "works";
const TABS: readonly { id: TabId; label: string }[] = [
  { id: "menu", label: "메뉴" },
  { id: "works", label: "말씀" },
];
// 서고 목록은 자주 바뀌지 않는다 — 메뉴를 열 때마다 다시 받지 않는다
const WORKS_STALE_MS = 5 * 60 * 1000;

/** showModal·close 가 없는 환경(jsdom)에서는 open 속성만 세운다 — 마크업·문구 검증은 그대로 돈다. */
function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  // 첫 조작 요소(닫기)가 아니라 제목에서 읽기를 시작한다
  dialog.querySelector<HTMLElement>(".mn__title")?.focus();
}

function volumeSummary(work: LibraryWork): string {
  return work.allowed_count >= work.volume_count
    ? `${work.volume_count}권`
    : `${work.allowed_count}/${work.volume_count}권 공개`;
}

function StarToggle({ label, isOn, onToggle }: { label: string; isOn: boolean; onToggle: () => void }) {
  return (
    <button className="mn-star" type="button" aria-pressed={isOn} aria-label={`${label} 즐겨찾기`} onClick={onToggle}>
      <Star size={22} fill={isOn ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  );
}

function FavGroup({
  kind,
  title,
  count,
  onReset,
  empty,
  children,
}: {
  kind: keyof Favorites;
  title: string;
  count: number;
  onReset: () => void;
  empty: string;
  children: ReactNode;
}) {
  return (
    <div className="mn-fav">
      <div className="mn-fav__head">
        <h3 className="mn-fav__t">{title}</h3>
        <button
          className="mn-reset"
          type="button"
          data-kind={kind}
          disabled={count === 0}
          aria-label={`${title} 초기화`}
          onClick={onReset}
        >
          <RotateCcw size={14} aria-hidden="true" />
          초기화
        </button>
      </div>
      {count > 0 ? (
        <ul className="mn-chips">{children}</ul>
      ) : (
        <p className="mn-empty">
          <Star size={14} aria-hidden="true" />
          {empty}
        </p>
      )}
    </div>
  );
}

function MenuRow({
  item,
  isFavorite,
  isCurrent,
  onGo,
  onToggle,
}: {
  item: MenuItem;
  isFavorite: boolean;
  isCurrent: boolean;
  onGo: () => void;
  onToggle: () => void;
}) {
  const Icon = item.icon;
  if (!item.isAvailable) {
    // 꺼진 화면은 숨기지 않고 이유를 글자로 남긴다 — 링크·별이 없다
    return (
      <li className="mn-row">
        <span className="mn-row__go" aria-disabled="true">
          <span className="mn-row__ic">
            <Icon size={20} aria-hidden="true" />
          </span>
          <span className="mn-row__t">{item.label}</span>
        </span>
        <span className="mn-soon">준비 중</span>
      </li>
    );
  }
  return (
    <li className="mn-row">
      <Link className="mn-row__go" href={item.href} aria-current={isCurrent ? "page" : undefined} onClick={onGo}>
        <span className="mn-row__ic">
          <Icon size={20} aria-hidden="true" />
        </span>
        <span className="mn-row__t">{item.label}</span>
      </Link>
      <StarToggle label={item.label} isOn={isFavorite} onToggle={onToggle} />
    </li>
  );
}

function WorksPanel({
  query,
  favorites,
  onGo,
  onToggle,
}: {
  query: ReturnType<typeof useWorksQuery>;
  favorites: Favorites;
  onGo: () => void;
  onToggle: (work: LibraryWork) => void;
}) {
  if (query.isPending)
    return (
      <p className="mn-status" role="status" aria-busy="true">
        저작물을 불러오고 있어요
      </p>
    );
  if (query.isError)
    return (
      <div className="mn-status" role="status">
        <p>저작물 목록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.</p>
        <button className="btn btn-line btn--sm" type="button" onClick={() => void query.refetch()}>
          다시 시도
        </button>
      </div>
    );
  const works = query.data.works ?? [];
  return (
    <section className="mn-group" aria-labelledby="mn-works-title">
      <h3 className="mn-group__t" id="mn-works-title">
        저작물
      </h3>
      <p className="mn-group__d">검색·원문 공개 권리를 확인한 저작물만 보여요</p>
      {works.length === 0 ? (
        <p className="mn-status">아직 공개된 저작물이 없어요.</p>
      ) : (
        <ul className="mn-list">
          {works.map((work) => (
            <li className="mn-row" key={work.series}>
              <Link className="mn-row__go" href={seriesHref(work.series)} onClick={onGo}>
                <span className="mn-row__t">{work.title}</span>
                <span className="mn-row__m">{volumeSummary(work)}</span>
              </Link>
              <StarToggle
                label={work.title}
                isOn={favorites.works.some((item) => item.series === work.series)}
                onToggle={() => onToggle(work)}
              />
            </li>
          ))}
        </ul>
      )}
      <Link className="mn-more" href="/hoondok/library" onClick={onGo}>
        말씀 서고 전체 보기
      </Link>
    </section>
  );
}

// 말씀 탭을 열었거나 저장된 말씀 칩을 새 값으로 맞춰야 할 때만 받는다 — 메뉴만 보는 사람에게는 요청이 없다
function useWorksQuery(isNeeded: boolean) {
  return useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: libraryAPI.list,
    retry: false,
    staleTime: WORKS_STALE_MS,
    enabled: isNeeded,
  });
}

type Undo = { message: string; restore: () => void };

export function MenuDrawer({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ menu: null, works: null });
  const pathname = usePathname();
  const favorites = useFavorites();
  const [tab, setTab] = useState<TabId>("menu");
  const worksQuery = useWorksQuery(tab === "works" || favorites.works.length > 0);
  const [undo, setUndo] = useState<Undo | null>(null);
  // 초기화·되돌리기는 누른 버튼을 없애거나 막는다 — 다음 렌더 뒤 포커스를 옮길 자리(선택자)를 적어 둔다
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    // 열기 전 포커스(햄버거 버튼)를 기억했다가 닫힐 때 돌려준다 — 여는 순간 포커스가 패널 안으로 옮겨 가므로 먼저 잡는다
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    if (dialog) openDialog(dialog);
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const selector = pendingFocus.current;
    if (!selector) return;
    const target = dialogRef.current?.querySelector<HTMLElement>(selector);
    if (target && !target.hasAttribute("disabled")) {
      pendingFocus.current = null;
      target.focus();
    }
  });

  // <dialog> 는 배경막 영역의 클릭도 자신이 받는다 — 패널 밖일 때만 닫는다
  function handleBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) onClose();
  }

  // 탭 목록은 화살표로 옮긴다 (roving tabindex)
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: TabId = tab === "menu" ? "works" : "menu";
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  function resetGroup(kind: keyof Favorites, message: string) {
    const snapshot = readFavorites()[kind];
    writeFavorites({ ...readFavorites(), [kind]: [] });
    pendingFocus.current = ".mn-undo button";
    setUndo({
      message,
      restore: () => {
        writeFavorites({ ...readFavorites(), [kind]: snapshot });
        pendingFocus.current = `.mn-reset[data-kind="${kind}"]`;
      },
    });
  }

  // 초기화 뒤 별을 다시 누르면 되돌리기는 거둔다 — 되돌리면 방금 누른 별이 사라지기 때문이다
  function toggleMenu(id: string) {
    toggleMenuFavorite(id);
    setUndo(null);
  }
  function toggleWork(work: LibraryWork) {
    toggleWorkFavorite({ series: work.series, title: work.title });
    setUndo(null);
  }

  const menuChips = favorites.menu.map(availableMenuItem).filter((item): item is MenuItem => item !== undefined);
  // 서고 응답이 있으면 지금 공개된 저작물만 남기고 제목도 새 값으로 쓴다. 응답 전·실패 때는 저장해 둔 이름으로 그린다
  const liveWorks = worksQuery.data?.works;
  const workChips = liveWorks
    ? favorites.works.flatMap((saved) => {
        const live = liveWorks.find((work) => work.series === saved.series);
        return live ? [{ series: live.series, title: live.title }] : [];
      })
    : favorites.works;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 배경막 클릭 닫기의 키보드 대응은 <dialog> 의 Esc 와 닫기 버튼이다
    <dialog className="mn" ref={dialogRef} aria-labelledby="mn-title" onClose={onClose} onClick={handleBackdrop}>
      <div className="mn__panel">
        <div className="mn__head">
          <h2 className="mn__title" id="mn-title" tabIndex={-1}>
            전체 메뉴
          </h2>
          <button className="icon-btn" type="button" aria-label="전체 메뉴 닫기" onClick={onClose}>
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <div className="mn__body">
          <div className="mn-favs">
            <FavGroup
              kind="menu"
              title="즐겨찾는 메뉴"
              count={menuChips.length}
              onReset={() => resetGroup("menu", "즐겨찾는 메뉴를 비웠어요")}
              empty="별을 누르면 자주 여는 메뉴가 여기에 모여요"
            >
              {menuChips.map((item) => (
                <li key={item.id}>
                  <Link className="mn-chip" href={item.href} onClick={onClose}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </FavGroup>
            <FavGroup
              kind="works"
              title="즐겨찾는 말씀"
              count={workChips.length}
              onReset={() => resetGroup("works", "즐겨찾는 말씀을 비웠어요")}
              empty="말씀 탭에서 별을 누르면 저작물이 여기에 모여요"
            >
              {workChips.map((work) => (
                <li key={work.series}>
                  <Link className="mn-chip" href={seriesHref(work.series)} onClick={onClose}>
                    {work.title}
                  </Link>
                </li>
              ))}
            </FavGroup>
            {/* 알림 영역은 늘 두고 내용만 바꾼다 — 비어 있다가 생긴 role=status 는 읽히지 않을 수 있다 */}
            <div className="mn-undo" role="status">
              {undo && (
                <>
                  <span id="mn-undo-msg">{undo.message}</span>
                  <button
                    type="button"
                    aria-describedby="mn-undo-msg"
                    onClick={() => {
                      undo.restore();
                      setUndo(null);
                    }}
                  >
                    되돌리기
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mn-tabs" role="tablist" aria-label="전체 메뉴 목록">
            {TABS.map((item) => (
              <button
                className="mn-tab"
                type="button"
                role="tab"
                key={item.id}
                id={`mn-tab-${item.id}`}
                ref={(node) => {
                  tabRefs.current[item.id] = node;
                }}
                aria-selected={tab === item.id}
                aria-controls="mn-panel"
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={handleTabKey}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mn-panel" id="mn-panel" role="tabpanel" aria-labelledby={`mn-tab-${tab}`}>
            {tab === "menu" ? (
              MENU_GROUPS.map((group) => (
                <section className="mn-group" key={group.id} aria-labelledby={`mn-group-${group.id}`}>
                  <h3 className="mn-group__t" id={`mn-group-${group.id}`}>
                    {group.title}
                  </h3>
                  <ul className="mn-list">
                    {group.items.map((item) => (
                      <MenuRow
                        key={item.id}
                        item={item}
                        isFavorite={favorites.menu.includes(item.id)}
                        isCurrent={pathname === item.href}
                        onGo={onClose}
                        onToggle={() => toggleMenu(item.id)}
                      />
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <WorksPanel query={worksQuery} favorites={favorites} onGo={onClose} onToggle={toggleWork} />
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
