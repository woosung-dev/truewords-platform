import {
  BarChart3,
  Bookmark,
  Bot,
  CalendarDays,
  Database,
  Flame,
  History,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** 그룹 머리. 대시보드처럼 혼자 서는 항목은 머리가 없다. */
  title?: string;
  items: NavItem[];
}

// 라벨·URL 은 그대로 두고 업무 단위로만 묶는다.
export const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: "/dashboard", label: "대시보드", icon: LayoutDashboard }] },
  {
    title: "챗봇·검색",
    items: [
      { href: "/chatbots", label: "챗봇", icon: Bot },
      { href: "/data-sources", label: "데이터 소스", icon: Database },
      { href: "/analytics", label: "검색 분석", icon: BarChart3 },
      { href: "/feedback", label: "피드백", icon: MessageSquare },
    ],
  },
  {
    title: "훈독",
    items: [
      { href: "/hoondok", label: "훈독 편성", icon: CalendarDays },
      { href: "/hoondok/cards", label: "오늘의 책갈피", icon: Bookmark },
      { href: "/hoondok/rights", label: "훈독 권리", icon: ScrollText },
      { href: "/hoondok/jeongseongs", label: "공식 정성", icon: Flame },
      { href: "/hoondok/groups", label: "모임", icon: Users },
    ],
  },
  {
    title: "관리",
    items: [
      { href: "/audit-logs", label: "감사 로그", icon: History },
      { href: "/settings", label: "설정", icon: Settings },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

/** 현재 경로에 해당하는 메뉴. `/hoondok/rights` 가 `/hoondok` 에 잡히지 않도록 가장 긴 경로를 고른다. */
export function findActiveNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}
