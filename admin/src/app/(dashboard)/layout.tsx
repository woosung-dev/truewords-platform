"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import AuthGuard from "@/components/auth-guard";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드", icon: "📊" },
  { href: "/chatbots", label: "챗봇", icon: "🤖" },
];

function Sidebar({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav className={`flex flex-col gap-1 p-4 ${className}`}>
      <div className="mb-4 px-2">
        <h2 className="text-lg font-bold">TrueWords Admin</h2>
      </div>
      <Separator className="mb-2" />
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
            pathname.startsWith(item.href)
              ? "bg-accent font-medium"
              : "text-muted-foreground"
          }`}
        >
          <span>{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </nav>
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
        <aside className="hidden w-56 shrink-0 border-r bg-card md:block">
          <Sidebar />
        </aside>

        <div className="flex flex-1 flex-col">
          {/* 상단 바 */}
          <header className="flex h-14 items-center justify-between border-b px-4">
            {/* 모바일 햄버거 */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                className="md:hidden"
                render={<Button variant="ghost" size="sm" />}
              >
                ☰
              </SheetTrigger>
              <SheetContent side="left" className="w-56 p-0">
                <Sidebar />
              </SheetContent>
            </Sheet>

            <div className="hidden md:block" />
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              로그아웃
            </Button>
          </header>

          {/* 메인 콘텐츠 */}
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
