"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authAPI } from "@/features/auth/api";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import AuthGuard from "@/features/auth/components/auth-guard";
import { useState } from "react";
import {
  LayoutDashboard,
  Bot,
  Database,
  ScrollText,
  BarChart3,
  MessageSquare,
  Settings,
  Menu,
  LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboard },
  { href: "/chatbots", label: "챗봇", icon: Bot },
  { href: "/data-sources", label: "데이터 소스", icon: Database },
  { href: "/analytics", label: "검색 분석", icon: BarChart3 },
  { href: "/feedback", label: "피드백", icon: MessageSquare },
  { href: "/audit-logs", label: "감사 로그", icon: ScrollText },
  { href: "/settings", label: "설정", icon: Settings },
];

function SidebarContent({
  onNavigate,
  onLogout,
}: {
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* 로고 */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border shrink-0">
        <div className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-white">TW</span>
        </div>
        <span className="font-semibold text-sidebar-foreground text-sm tracking-tight">
          TrueWords Admin
        </span>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary font-medium"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 로그아웃 */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <button
          onClick={onLogout}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
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
  return (
    <span className="text-sm font-medium text-foreground">
      {found?.label ?? ""}
    </span>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    try {
      await authAPI.logout();
    } finally {
      router.push("/login");
    }
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        {/* 데스크톱 사이드바 */}
        <aside className="hidden w-56 shrink-0 md:block border-r border-sidebar-border">
          <div className="sticky top-0 h-screen">
            <SidebarContent onLogout={handleLogout} />
          </div>
        </aside>

        <div className="flex flex-1 flex-col min-w-0">
          {/* 상단 헤더 */}
          <header className="flex h-14 items-center gap-3 border-b bg-background px-4 shrink-0">
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
                <SidebarContent
                  onNavigate={() => setMobileOpen(false)}
                  onLogout={handleLogout}
                />
              </SheetContent>
            </Sheet>

            <PageTitle />
          </header>

          {/* 메인 콘텐츠 */}
          <main className="flex-1 p-6 bg-muted/20">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
