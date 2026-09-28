"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Bookmark,
  Bot,
  CalendarDays,
  Database,
  Flame,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { authAPI } from "@/features/auth/api";
import AuthGuard from "@/features/auth/components/auth-guard";
import { WEB_ORIGIN } from "@/lib/origins";

const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboard },
  { href: "/chatbots", label: "챗봇", icon: Bot },
  { href: "/hoondok/rights", label: "훈독 권리", icon: ScrollText },
  { href: "/hoondok/jeongseongs", label: "공식 정성", icon: Flame },
  { href: "/hoondok/groups", label: "모임", icon: Users },
  { href: "/hoondok/cards", label: "오늘의 책갈피", icon: Bookmark },
  { href: "/hoondok", label: "훈독 편성", icon: CalendarDays },
  { href: "/data-sources", label: "데이터 소스", icon: Database },
  { href: "/analytics", label: "검색 분석", icon: BarChart3 },
  { href: "/feedback", label: "피드백", icon: MessageSquare },
  { href: "/audit-logs", label: "감사 로그", icon: ScrollText },
  { href: "/settings", label: "설정", icon: Settings },
];

// 사이드바(slate-950) 위에서는 전역 outline-ring/50(1.2:1)이 보이지 않으므로 밝은 sidebar-ring 링을 따로 준다.
const SIDEBAR_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring";

function SidebarContent({ onNavigate, onLogout }: { onNavigate?: () => void; onLogout: () => void }) {
  const pathname = usePathname();

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
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = NAV_ITEMS.find((candidate) => pathname.startsWith(candidate.href)) === item;
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
            </Link>
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
  const found = NAV_ITEMS.find((item) => pathname.startsWith(item.href));
  return <span className="text-sm font-medium text-foreground">{found?.label ?? ""}</span>;
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
          {/* 상단 헤더 */}
          <header className="flex h-14 items-center gap-3 border-b bg-admin-bg px-4 shrink-0">
            {/* 모바일 햄버거 */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                  className: "md:hidden -ml-2",
                })}
              >
                <Menu className="w-5 h-5" />
              </SheetTrigger>
              <SheetContent side="left" className="w-56 p-0 border-r border-sidebar-border">
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
