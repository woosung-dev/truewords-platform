"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { ListIcon } from "@phosphor-icons/react/dist/ssr/List";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { UserCircleIcon } from "@phosphor-icons/react/dist/ssr/UserCircle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FocusEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { HeaderSearch, type HeaderSearchVariant } from "@/features/hoondok/library/components/header-search";
import { MenuDrawer } from "@/features/hoondok/menu/components/menu-drawer";
import { canGoBackInApp } from "@/features/hoondok/nav-history";
import { HOONDOK_LOGO } from "@/features/hoondok/pwa";
import { HoondokScreenTitleContext } from "@/features/hoondok/screen-title";
import { screenFor } from "@/features/hoondok/screens";
import { HOONDOK_TABS } from "@/features/hoondok/tabs";

const ACCOUNT_HREF = "/settings";
const INBOX_HREF = "/notifications";
// PC 헤더 검색 자리는 이 폭부터 보인다(hoondok.css .nav lg 블록). 그 아래는 앱바 돋보기가 연다.
const PC_QUERY = "(min-width: 1024px)";

function isPcWidth() {
  return window.matchMedia?.(PC_QUERY).matches ?? false;
}

// 고정 탐색 뒤에 가려진 키보드 초점만 읽기 영역 가운데로 옮긴다.
function revealFocusedControl(event: FocusEvent<HTMLElement>) {
  const control = event.target;
  if (!control.matches(":focus-visible") || control.closest("dialog, .appbar, .ps-bar")) return;
  const rect = control.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const visible = [rect.top + 2, rect.top + rect.height / 2, rect.bottom - 2].every((y) => {
    const hit = document.elementFromPoint(rect.left + rect.width / 2, y);
    return hit === control || (hit !== null && control.contains(hit));
  });
  if (!visible) control.scrollIntoView({ block: "center", behavior: "instant" });
}

// 앱 셸 = 앱바(헤더) + 탭 내비. 탭 정의 한 목록을 <1024px 하단 5탭, ≥1024px 상단 헤더 4 로 렌더한다
// (DES-PWA-003 §8 2026-09-16 결정). 형태 차이는 hoondok.css .nav 가 담당하고 마크업은 하나다.
// 제목·뒤로 링크·본문 폭·활성 탭은 화면 레지스트리(features/hoondok/screens.ts) 가 pathname 으로 정한다.
// 오른쪽 끝은 사람(관리) · 종(알림센터) · 햄버거(전체 메뉴 드로어) 순이다. 햄버거는 탭이 있는 화면에서만 보인다.
export function HoondokAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const screen = screenFor(pathname);
  const [resolvedTitle, setResolvedTitle] = useState<{ pathname: string; title: string } | null>(null);
  const updateTitle = useCallback(
    (title: string | null) => {
      setResolvedTitle((previous) => (title ? { pathname, title } : previous?.pathname === pathname ? null : previous));
    },
    [pathname],
  );
  // 연 경로를 기억한다 — 드로어 밖에서 경로가 바뀌면(뒤로 가기·스와이프) 새 화면 위에 남지 않고 닫힌다
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const isMenuOpen = menuPath === pathname;
  // 머리글 제자리 검색. 메뉴처럼 연 경로를 기억해 경로가 바뀌면 닫힌 것으로 본다
  const [searchOpen, setSearchOpen] = useState<{ path: string; variant: HeaderSearchVariant } | null>(null);
  if (searchOpen && searchOpen.path !== pathname) setSearchOpen(null);
  const searchVariant = searchOpen?.path === pathname ? searchOpen.variant : null;
  const isSearching = searchVariant !== null;
  const searchId = useId();
  const pcSearchRef = useRef<HTMLButtonElement>(null);
  const mobileSearchRef = useRef<HTMLButtonElement>(null);
  // 닫힌 뒤 초점을 돌려줄 여는 버튼. 링크로 떠날 때는 비운다
  const focusBackRef = useRef<HeaderSearchVariant | null>(null);

  const openSearch = useCallback(
    (variant: HeaderSearchVariant) => {
      // 모바일 검색 층은 기록 한 칸을 넣어 폰의 뒤로 가기가 화면 대신 층을 닫게 한다.
      // 주소는 그대로라 Next 라우터는 같은 화면으로 본다(pushState 가 Next 내부 상태를 이어 붙인다)
      if (variant === "mobile") window.history.pushState({ hoondokSearch: true }, "");
      setSearchOpen({ path: pathname, variant });
    },
    [pathname],
  );
  const closeSearch = useCallback(
    (restoreFocus: boolean) => {
      focusBackRef.current = restoreFocus ? searchVariant : null;
      // 넣어 둔 기록 칸이 맨 위에 있으면 되돌린다 — popstate 가 층을 닫는다
      if (searchVariant === "mobile" && window.history.state?.hoondokSearch) {
        window.history.back();
        return;
      }
      setSearchOpen(null);
    },
    [searchVariant],
  );
  // 층 안의 링크는 replace 로 이동해 기록 칸을 대신 쓰므로 되돌리지 않고 닫기만 한다
  const leaveSearch = useCallback(() => {
    focusBackRef.current = null;
    setSearchOpen(null);
  }, []);

  useEffect(() => {
    if (searchVariant !== "mobile") return;
    const onPopState = () => {
      focusBackRef.current ??= "mobile";
      setSearchOpen(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [searchVariant]);

  // 화면을 돌려 PC·모바일 폭이 바뀌면 열린 모양이 맞지 않으니 닫는다
  useEffect(() => {
    if (!searchVariant || !window.matchMedia) return;
    const query = window.matchMedia(PC_QUERY);
    const onChange = () => {
      if (query.matches !== (searchVariant === "pc")) closeSearch(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [searchVariant, closeSearch]);

  useEffect(() => {
    if (isSearching) return;
    const target = focusBackRef.current;
    focusBackRef.current = null;
    if (target === "pc") pcSearchRef.current?.focus();
    if (target === "mobile") mobileSearchRef.current?.focus();
  }, [isSearching]);

  // ⌘K / Ctrl+K 로 연다(열려 있으면 ESC 로 닫는다). 한글 자판에서도 잡히게 물리 키(KeyK)도 본다
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // 패널 안 빈 곳을 누르거나 누른 버튼이 사라져 초점이 대화상자 밖(body)으로 빠져도 ESC 로 닫는다
      if (event.key === "Escape" && isSearching && !event.defaultPrevented) {
        event.preventDefault();
        closeSearch(true);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.code !== "KeyK" && event.key?.toLowerCase() !== "k") return;
      if (isMenuOpen) return;
      event.preventDefault();
      if (isSearching) return;
      const variant: HeaderSearchVariant = isPcWidth() ? "pc" : "mobile";
      // 여는 버튼이 없는 화면에서는 열지 않는다
      if (variant === "pc" ? screen.hideNav : screen.hideSearchLink) return;
      openSearch(variant);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMenuOpen, isSearching, screen.hideNav, screen.hideSearchLink, openSearch, closeSearch]);
  const title =
    screen.titleSource === "work" && resolvedTitle?.pathname === pathname ? resolvedTitle.title : screen.title;

  return (
    <HoondokScreenTitleContext.Provider value={updateTitle}>
      <main
        inert={isSearching}
        onFocusCapture={revealFocusedControl}
        className={`app__main app__main--${screen.variant}${screen.hideNav ? " app__main--no-nav" : ""}`}
      >
        <header className="appbar">
          <div className="appbar__in">
            {screen.backHref && (
              <Link
                className="icon-btn"
                href={screen.backHref}
                aria-label="뒤로"
                onClick={(event) => {
                  // 답 화면처럼 여러 곳에서 들어오는 화면은 들어온 곳(원문·보던 탭)으로 돌아간다
                  if (!screen.backToHistory || !canGoBackInApp()) return;
                  event.preventDefault();
                  window.history.back();
                }}
              >
                <ArrowLeftIcon size={22} aria-hidden="true" />
              </Link>
            )}
            <h1 className="appbar__title">{title}</h1>
            {!screen.hideSearchLink && (
              <button
                ref={mobileSearchRef}
                className="icon-btn icon-btn--search"
                type="button"
                aria-label="말씀 검색"
                aria-haspopup="dialog"
                aria-expanded={searchVariant === "mobile"}
                aria-controls={searchVariant === "mobile" ? searchId : undefined}
                onClick={() => openSearch("mobile")}
              >
                <MagnifyingGlassIcon size={22} aria-hidden="true" />
              </button>
            )}
            {!screen.hideSettingsLink && (
              <>
                <Link
                  className="icon-btn icon-btn--account"
                  href={ACCOUNT_HREF}
                  aria-label="관리"
                  aria-current={screen.match === ACCOUNT_HREF ? "page" : undefined}
                >
                  <UserCircleIcon size={24} aria-hidden="true" />
                </Link>
                <Link
                  className="icon-btn icon-btn--bell"
                  href={INBOX_HREF}
                  aria-label="알림센터"
                  aria-current={screen.match === INBOX_HREF ? "page" : undefined}
                >
                  <BellSimpleIcon size={22} aria-hidden="true" />
                </Link>
              </>
            )}
            {!screen.hideNav && (
              <button
                className="icon-btn icon-btn--menu"
                type="button"
                aria-label="전체 메뉴"
                aria-haspopup="dialog"
                aria-expanded={isMenuOpen}
                onClick={() => setMenuPath(pathname)}
              >
                <ListIcon size={22} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>
        {children}
      </main>
      {!screen.hideNav && (
        <nav
          className={`nav${searchVariant === "pc" ? " nav--searching" : ""}`}
          aria-label="주 메뉴"
          inert={searchVariant === "mobile"}
        >
          <Link className="nav__brand" href="/" inert={isSearching}>
            <img className="nav__mark" src={HOONDOK_LOGO} alt="" width={32} height={32} />
            훈독
          </Link>
          {HOONDOK_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === screen.tabId;
            const className = "nav__item";
            const inner = (
              <>
                <span className="nav__ic">
                  <Icon size={24} weight={isActive ? "fill" : "regular"} aria-hidden="true" />
                </span>
                {tab.label}
              </>
            );
            return tab.isDisabled ? (
              <span key={tab.id} className={className} aria-disabled="true" title="준비 중" inert={isSearching}>
                {inner}
              </span>
            ) : (
              <Link
                key={tab.id}
                className={className}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                inert={isSearching}
              >
                {inner}
              </Link>
            );
          })}
          {/* 헤더 검색 자리 — 누르거나 ⌘K 로 같은 자리에서 입력으로 펼쳐지고 아래로 결과 패널이 열린다 */}
          <div className="nav__search-slot">
            {searchVariant === "pc" ? (
              <HeaderSearch id={searchId} variant="pc" onClose={() => closeSearch(true)} onLeave={leaveSearch} />
            ) : (
              <button
                ref={pcSearchRef}
                className="nav__search"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={false}
                aria-keyshortcuts="Meta+K Control+K"
                onClick={() => openSearch("pc")}
              >
                <MagnifyingGlassIcon size={20} aria-hidden="true" />
                말씀 검색
              </button>
            )}
          </div>
          {!screen.hideSettingsLink && (
            <>
              <Link
                className="nav__user"
                inert={isSearching}
                href={ACCOUNT_HREF}
                aria-label="관리"
                aria-current={screen.match === ACCOUNT_HREF ? "page" : undefined}
              >
                <UserCircleIcon size={22} aria-hidden="true" />
              </Link>
              <Link
                className="nav__user nav__user--bell"
                inert={isSearching}
                href={INBOX_HREF}
                aria-label="알림센터"
                aria-current={screen.match === INBOX_HREF ? "page" : undefined}
              >
                <BellSimpleIcon size={18} aria-hidden="true" />
              </Link>
            </>
          )}
          <button
            className="nav__menu"
            type="button"
            inert={isSearching}
            aria-label="전체 메뉴"
            aria-haspopup="dialog"
            aria-expanded={isMenuOpen}
            onClick={() => setMenuPath(pathname)}
          >
            <ListIcon size={18} aria-hidden="true" />
          </button>
        </nav>
      )}
      {searchVariant === "pc" && <div className="hs-backdrop" aria-hidden="true" onClick={() => closeSearch(true)} />}
      {searchVariant === "mobile" && (
        <HeaderSearch id={searchId} variant="mobile" onClose={() => closeSearch(true)} onLeave={leaveSearch} />
      )}
      {isMenuOpen && <MenuDrawer onClose={() => setMenuPath(null)} />}
    </HoondokScreenTitleContext.Provider>
  );
}
