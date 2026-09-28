import {
  Bell,
  BookMarked,
  Bookmark,
  BookOpen,
  CirclePlay,
  Library,
  ListOrdered,
  type LucideIcon,
  MessageCircle,
  Mic,
  ScrollText,
  Search,
  Sprout,
  Sunrise,
  UserPlus,
  Users,
} from "lucide-react";
import { isHoondokCardsEnabled, isHoondokPreviewEnabled, isHoondokTogetherEnabled } from "@/features/hoondok/flag";

// 전체 메뉴(앱바 햄버거)의 "메뉴" 탭 목록. 묶음은 하단 5탭과 같은 이름·순서이고, 항목은 이미 있는 화면만 둔다.
// 꺼진 플래그의 화면은 숨기지 않고 "준비 중" 으로 남긴다 — 탭 내비의 준비 중 탭과 같은 신호다.
export type MenuItem = {
  /** 즐겨찾기 저장 키. 한 번 정하면 바꾸지 않는다 — 바꾸면 저장된 즐겨찾기가 조용히 사라진다 */
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  isAvailable: boolean;
};

export type MenuGroup = { id: string; title: string; items: readonly MenuItem[] };

type MenuItemDef = Omit<MenuItem, "isAvailable"> & { isAvailable?: () => boolean };

const GROUP_DEFS: readonly { id: string; title: string; items: readonly MenuItemDef[] }[] = [
  {
    id: "today",
    title: "오늘 훈독",
    items: [
      { id: "today", label: "오늘 훈독", href: "/hoondok", icon: Sunrise },
      { id: "read", label: "훈독하기", href: "/hoondok/read", icon: BookOpen },
      {
        id: "bookmark",
        label: "오늘의 책갈피",
        href: "/hoondok/bookmark",
        icon: Bookmark,
        isAvailable: isHoondokCardsEnabled,
      },
      {
        id: "group-new",
        label: "모임 만들기",
        href: "/hoondok/groups/new",
        icon: Users,
        isAvailable: isHoondokTogetherEnabled,
      },
      {
        id: "group-join",
        label: "모임 참여",
        href: "/hoondok/groups/join",
        icon: UserPlus,
        isAvailable: isHoondokTogetherEnabled,
      },
    ],
  },
  {
    id: "ask",
    title: "AI 질문",
    items: [
      { id: "ask", label: "질문하기", href: "/hoondok/ask", icon: MessageCircle },
      { id: "ask-log", label: "질문 기록", href: "/hoondok/ask/log", icon: ScrollText },
    ],
  },
  {
    id: "library",
    title: "말씀",
    items: [
      { id: "library", label: "말씀 서고", href: "/hoondok/library", icon: Library },
      { id: "search", label: "말씀 검색", href: "/hoondok/search", icon: Search },
    ],
  },
  {
    id: "worship",
    title: "가정예배",
    items: [
      {
        id: "sermons",
        label: "5분 설교",
        href: "/hoondok/worship",
        icon: CirclePlay,
        isAvailable: isHoondokPreviewEnabled,
      },
      {
        id: "worship-order",
        label: "순서지·챌린지",
        href: "/hoondok/worship/order",
        icon: ListOrdered,
        isAvailable: isHoondokPreviewEnabled,
      },
      {
        id: "sermon-request",
        label: "설교 섭외",
        href: "/hoondok/worship/request",
        icon: Mic,
        isAvailable: isHoondokPreviewEnabled,
      },
    ],
  },
  {
    id: "garden",
    title: "나의 정원",
    items: [
      { id: "garden", label: "나의 정원", href: "/hoondok/garden", icon: Sprout },
      {
        id: "bookmarks",
        label: "나의 책갈피",
        href: "/hoondok/bookmarks",
        icon: BookMarked,
        isAvailable: isHoondokCardsEnabled,
      },
      { id: "family", label: "가족·친구", href: "/hoondok/family", icon: Users, isAvailable: isHoondokPreviewEnabled },
      { id: "settings", label: "알림·설치", href: "/hoondok/settings", icon: Bell },
    ],
  },
];

// 플래그는 빌드 시 인라인되므로 모듈 상수로 한 번만 산출한다 (tabs.ts 와 같다).
export const MENU_GROUPS: readonly MenuGroup[] = GROUP_DEFS.map((group) => ({
  id: group.id,
  title: group.title,
  items: group.items.map(({ isAvailable, ...item }) => ({ ...item, isAvailable: isAvailable ? isAvailable() : true })),
}));

const MENU_ITEMS = new Map(MENU_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item]));

/** 즐겨찾기 id → 지금 열 수 있는 메뉴. 없어졌거나 꺼진 메뉴는 undefined 다. */
export function availableMenuItem(id: string): MenuItem | undefined {
  const item = MENU_ITEMS.get(id);
  return item?.isAvailable ? item : undefined;
}
