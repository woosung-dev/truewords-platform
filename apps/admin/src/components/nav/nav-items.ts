import {
  BarChart3,
  Bookmark,
  Bot,
  CalendarDays,
  Database,
  LayoutDashboard,
  type LucideIcon,
  MessageCircleQuestionMark,
  MessageSquare,
  ScrollText,
  Settings,
  Waypoints,
} from "lucide-react";

// 그룹은 운영자의 하루 흐름 순서: 현황 확인 → 훈독 콘텐츠 → 챗봇·검색 품질 → 시스템
export const NAV_GROUPS = [
  { id: "status", label: "현황" },
  { id: "hoondok", label: "훈독 콘텐츠" },
  { id: "quality", label: "챗봇·검색 품질" },
  { id: "system", label: "시스템" },
] as const;

export type NavGroupId = (typeof NAV_GROUPS)[number]["id"];

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroupId;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboard, group: "status" },
  { href: "/analytics", label: "검색 분석", icon: BarChart3, group: "status" },
  { href: "/hoondok", label: "훈독 편성", icon: CalendarDays, group: "hoondok" },
  { href: "/hoondok/cards", label: "오늘의 책갈피", icon: Bookmark, group: "hoondok" },
  { href: "/hoondok/questions", label: "추천 질문 고르기", icon: MessageCircleQuestionMark, group: "hoondok" },
  { href: "/hoondok/summaries", label: "말씀 AI 요약", icon: ScrollText, group: "hoondok" },
  { href: "/hoondok/rights", label: "훈독 권리", icon: ScrollText, group: "hoondok" },
  { href: "/feedback", label: "피드백", icon: MessageSquare, group: "quality" },
  { href: "/rag-trace", label: "파이프라인 추적", icon: Waypoints, group: "quality" },
  { href: "/chatbots", label: "챗봇", icon: Bot, group: "quality" },
  { href: "/data-sources", label: "데이터 소스", icon: Database, group: "quality" },
  { href: "/audit-logs", label: "감사 로그", icon: ScrollText, group: "system" },
  { href: "/settings", label: "설정", icon: Settings, group: "system" },
];

export function groupLabel(id: NavGroupId): string {
  return NAV_GROUPS.find((g) => g.id === id)?.label ?? "";
}

export function navItemByHref(href: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === href);
}

/** 가장 긴 href 접두사(세그먼트 경계)가 활성 메뉴다. /hoondok/cards 에서 "훈독 편성"이 켜지면 안 된다. */
export function findActiveNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best;
}
