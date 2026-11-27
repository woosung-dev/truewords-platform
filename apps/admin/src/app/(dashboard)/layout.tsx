"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu, MessageSquare } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MenuSearch } from "@/components/nav/menu-search";
import { findActiveNavItem } from "@/components/nav/nav-items";
import { NavPrefsProvider } from "@/components/nav/nav-prefs";
import { SIDEBAR_FOCUS, SidebarNav } from "@/components/nav/sidebar-nav";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { authAPI } from "@/features/auth/api";
import AuthGuard from "@/features/auth/components/auth-guard";
import { WEB_ORIGIN } from "@/lib/origins";

function SidebarContent({ onNavigate, onLogout }: { onNavigate?: () => void; onLogout: () => void }) {
  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* 로고 */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border shrink-0">
        <div className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-white">TW</span>
        </div>
        <span className="font-semibold text-sidebar-foreground text-sm tracking-tight">TrueWords Admin</span>
      </div>

      <SidebarNav onNavigate={onNavigate} />

      {/* 로그아웃 */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <a
          href={WEB_ORIGIN}
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground ${SIDEBAR_FOCUS}`}
        >
          <MessageSquare className="w-4 h-4 shrink-0" />
          사용자 웹
        </a>
        <button
          onClick={onLogout}
          className={`flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors ${SIDEBAR_FOCUS}`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          로그아웃
        </button>
      </div>
    </div>
  );
}

function PageTitle() {
  const pathname = usePathname();
  return (
    <span className="min-w-0 truncate text-sm font-medium text-foreground md:w-40 md:shrink-0">
      {findActiveNavItem(pathname)?.label ?? ""}
    </span>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  // admin 컨텍스트에서 paper × warm 토큰을 cool slate 로 차단.
  // body 에 클래스 적용해야 portal(Sheet/Dialog) 도 inherit.
  useEffect(() => {
    document.body.classList.add("admin-scope");
    return () => document.body.classList.remove("admin-scope");
  }, []);

  async function handleLogout() {
    try {
      await authAPI.logout();
    } finally {
      queryClient.clear();
      router.push("/login");
    }
  }

  return (
    <AuthGuard requireAdmin>
      <NavPrefsProvider>
      {/* 키보드 사용자가 사이드바 메뉴를 건너뛰고 본문으로 바로 가는 링크. 포커스될 때만 보인다. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        본문으로 건너뛰기
      </a>
      <div className="flex min-h-screen bg-admin-bg">
        {/* 데스크톱 사이드바 */}
        <aside className="hidden w-56 shrink-0 md:block border-r border-sidebar-border">
          <div className="sticky top-0 h-screen">
            <SidebarContent onLogout={handleLogout} />
          </div>
        </aside>

        <div className="flex flex-1 flex-col min-w-0">
          {/* 상단 헤더 */}
          <header className="flex h-14 items-center gap-3 border-b bg-admin-bg px-4 shrink-0">
            {/* 모바일 햄버거 */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                aria-label="관리자 메뉴 열기"
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                  className: "md:hidden -ml-2",
                })}
              >
                <Menu className="w-5 h-5" />
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-56 p-0 border-r border-sidebar-border [&_[data-slot=sheet-close]]:text-sidebar-foreground [&_[data-slot=sheet-close]]:hover:bg-sidebar-accent [&_[data-slot=sheet-close]]:focus-visible:ring-sidebar-ring"
              >
                <SheetTitle className="sr-only">관리자 메뉴</SheetTitle>
                <SheetDescription className="sr-only">관리할 화면을 선택하세요.</SheetDescription>
                <SidebarContent onNavigate={() => setMobileOpen(false)} onLogout={handleLogout} />
              </SheetContent>
            </Sheet>

            <PageTitle />
            <MenuSearch />
            {/* 제목 폭과 맞춰 검색창을 가운데에 둔다 */}
            <div aria-hidden="true" className="hidden md:block md:w-40 md:shrink-0" />
          </header>

          {/* 메인 콘텐츠 */}
          <main id="main-content" tabIndex={-1} className="flex-1 p-6 bg-admin-bg outline-none">
            {children}
          </main>
        </div>
      </div>
      </NavPrefsProvider>
    </AuthGuard>
  );
}
