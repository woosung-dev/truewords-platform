"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu, MessageSquare } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { authAPI } from "@/features/auth/api";
import AuthGuard from "@/features/auth/components/auth-guard";
import { ScheduleStockNavBadge } from "@/features/hoondok/components/schedule-stock";
import { WEB_ORIGIN } from "@/lib/origins";
import { findActiveNavItem, NAV_GROUPS } from "./nav-items";

// 사이드바(slate-950) 위에서는 전역 outline-ring/50(1.2:1)이 보이지 않으므로 밝은 sidebar-ring 링을 따로 준다.
const SIDEBAR_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring";

function SidebarContent({ onNavigate, onLogout }: { onNavigate?: () => void; onLogout: () => void }) {
  const pathname = usePathname();
  const activeItem = findActiveNavItem(pathname);
  // 데스크톱 사이드바와 모바일 Sheet 가 함께 그려질 수 있어 그룹 머리 id 를 인스턴스마다 다르게 둔다.
  const navId = useId();

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* 로고 */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border shrink-0">
        <div className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-white">TW</span>
        </div>
        <span className="font-semibold text-sidebar-foreground text-sm tracking-tight">TrueWords Admin</span>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, groupIndex) => {
          const headingId = group.title ? `${navId}-${groupIndex}` : undefined;
          return (
            <div
              key={group.title ?? groupIndex}
              role={group.title ? "group" : undefined}
              aria-labelledby={headingId}
              className="space-y-0.5"
            >
              {group.title && (
                <p id={headingId} className="px-3 pt-4 pb-1 text-[11px] font-medium text-sidebar-foreground/45">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => {
                const isActive = activeItem === item;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={`relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${SIDEBAR_FOCUS} ${
                      isActive
                        ? // 활성 글자는 밝은 전경(16:1), brass 는 좌측 막대·아이콘에만 쓴다(글자로 쓰면 3.3:1 미달).
                          "bg-sidebar-accent text-sidebar-foreground font-medium before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary"
                        : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-sidebar-primary" : ""}`} />
                    {item.label}
                    {/* 편성 재고: 어느 관리 화면에서나 남은 일수를 본다. 편성 화면과 같은 쿼리라 요청이 늘지 않는다. */}
                    {item.href === "/hoondok" && <ScheduleStockNavBadge />}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

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
  const found = findActiveNavItem(pathname);
  return <span className="text-sm font-medium text-foreground">{found?.label ?? ""}</span>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);

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
      {/* 키보드 사용자가 사이드바 14개 링크를 건너뛰고 본문으로 바로 가는 링크. 포커스될 때만 보인다. */}
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
          {/* 상단 헤더 — 모바일 전용. 데스크톱은 사이드바 활성 항목과 h1 이 위치를 알린다. */}
          <header className="flex h-14 items-center gap-3 border-b bg-admin-bg px-4 shrink-0 md:hidden">
            {/* 모바일 햄버거 */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                aria-label="메뉴 열기"
                className={buttonVariants({
                  variant: "ghost",
                  size: "icon",
                  className: "size-11 -ml-3",
                })}
              >
                <Menu className="w-5 h-5" />
              </SheetTrigger>
              {/* 닫기 버튼은 기본이 밝은 패널용 색이라 어두운 사이드바에서 보이지 않는다 */}
              <SheetContent
                side="left"
                className="w-56 p-0 border-r border-sidebar-border [&>[data-slot=sheet-close]]:text-sidebar-foreground/70 [&>[data-slot=sheet-close]]:hover:bg-sidebar-accent [&>[data-slot=sheet-close]]:hover:text-sidebar-foreground"
              >
                <SheetTitle className="sr-only">관리자 메뉴</SheetTitle>
                <SidebarContent onNavigate={() => setMobileOpen(false)} onLogout={handleLogout} />
              </SheetContent>
            </Sheet>

            <PageTitle />
          </header>

          {/* 메인 콘텐츠 */}
          <main id="main-content" tabIndex={-1} className="flex-1 p-6 bg-admin-bg outline-none">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
