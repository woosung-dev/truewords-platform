"use client";

import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { screenFor } from "@/features/hoondok/screens";
import { HOONDOK_TABS } from "@/features/hoondok/tabs";

// 앱 셸 = 앱바(헤더) + 탭 내비. 탭 정의 한 목록을 <1024px 하단 5탭, ≥1024px 상단 헤더 4 로 렌더한다
// (DES-PWA-003 §8 2026-09-16 결정). 형태 차이는 hoondok.css .nav 가 담당하고 마크업은 하나다.
// 제목·뒤로 링크·본문 폭·활성 탭은 화면 레지스트리(features/hoondok/screens.ts) 가 pathname 으로 정한다.
export function HoondokAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const screen = screenFor(pathname);
  // 말씀 검색 화면은 프리뷰 플래그에서만 존재한다 — OFF 면 검색 아이콘은 장식으로 남긴다.
  const isSearchLive = isHoondokPreviewEnabled();

  return (
    <>
      <main className={`app__main app__main--${screen.variant}`}>
        <header className="appbar">
          <div className="appbar__in">
            {screen.backHref && (
              <Link className="icon-btn" href={screen.backHref} aria-label="뒤로">
                <ArrowLeft size={22} />
              </Link>
            )}
            <h1 className="appbar__title">{screen.title}</h1>
            {isSearchLive ? (
              <Link className="icon-btn icon-btn--search" href="/hoondok/search" aria-label="말씀 검색">
                <Search size={22} />
              </Link>
            ) : (
              <span className="icon-btn icon-btn--search" aria-hidden="true">
                <Search size={22} />
              </span>
            )}
          </div>
        </header>
        {children}
      </main>
      <nav className="nav" aria-label="주 메뉴">
        <Link className="nav__brand" href="/hoondok">
          훈독
        </Link>
        {HOONDOK_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === screen.tabId;
          const className = `nav__item${tab.isMid ? " nav__item--mid" : ""}`;
          const inner = (
            <>
              <span className="nav__ic">
                <Icon size={tab.isMid ? 27 : 24} fill={isActive && !tab.isMid ? "currentColor" : "none"} />
              </span>
              {tab.label}
            </>
          );
          return tab.isDisabled ? (
            <span key={tab.id} className={className} aria-disabled="true" title="준비 중">
              {inner}
            </span>
          ) : (
            <Link key={tab.id} className={className} href={tab.href} aria-current={isActive ? "page" : undefined}>
              {inner}
            </Link>
          );
        })}
        {isSearchLive ? (
          <Link className="nav__search" href="/hoondok/search">
            <Search size={18} />
            말씀 검색
          </Link>
        ) : (
          <span className="nav__search" aria-hidden="true">
            <Search size={18} />
            말씀 검색 (준비 중)
          </span>
        )}
      </nav>
    </>
  );
}
