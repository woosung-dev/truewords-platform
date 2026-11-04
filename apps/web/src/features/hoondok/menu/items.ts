import type { Icon } from "@phosphor-icons/react";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/dist/ssr/BookmarkSimple";
import { BookmarksSimpleIcon } from "@phosphor-icons/react/dist/ssr/BookmarksSimple";
import { BookOpenTextIcon } from "@phosphor-icons/react/dist/ssr/BookOpenText";
import { BooksIcon } from "@phosphor-icons/react/dist/ssr/Books";
import { ChatCircleDotsIcon } from "@phosphor-icons/react/dist/ssr/ChatCircleDots";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { PlantIcon } from "@phosphor-icons/react/dist/ssr/Plant";
import { ScrollIcon } from "@phosphor-icons/react/dist/ssr/Scroll";
import { SunHorizonIcon } from "@phosphor-icons/react/dist/ssr/SunHorizon";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { isHoondokCardsEnabled } from "@/features/hoondok/flag";

// 전체 메뉴(앱바 햄버거)의 "메뉴" 탭 목록. 묶음은 하단 5탭과 같은 이름·순서이고, 항목은 이미 있는 화면만 둔다.
// 꺼진 플래그의 화면은 숨기지 않고 "준비 중" 으로 남긴다 — 탭 내비의 준비 중 탭과 같은 신호다.
export type MenuItem = {
  /** 즐겨찾기 저장 키. 한 번 정하면 바꾸지 않는다 — 바꾸면 저장된 즐겨찾기가 조용히 사라진다 */
  id: string;
  label: string;
  href: string;
  icon: Icon;
  isAvailable: boolean;
};

export type MenuGroup = { id: string; title: string; items: readonly MenuItem[] };

type MenuItemDef = Omit<MenuItem, "isAvailable"> & { isAvailable?: () => boolean };

/** 화면이 아직 없는 항목 — 늘 "준비 중" 으로 남긴다 */
const isComingSoon = () => false;

const GROUP_DEFS: readonly { id: string; title: string; items: readonly MenuItemDef[] }[] = [
  {
    id: "today",
    title: "오늘 훈독",
    items: [
      { id: "today", label: "오늘 훈독", href: "/", icon: SunHorizonIcon },
      { id: "read", label: "훈독하기", href: "/read", icon: BookOpenTextIcon },
      {
        id: "bookmark",
        label: "오늘의 책갈피",
        href: "/bookmark",
        icon: BookmarkSimpleIcon,
        isAvailable: isHoondokCardsEnabled,
      },
    ],
  },
  {
    id: "ask",
    title: "AI 질문",
    items: [
      { id: "ask", label: "질문하기", href: "/ask/new", icon: ChatCircleDotsIcon },
      { id: "ask-log", label: "질문 기록", href: "/ask?tab=mine", icon: ScrollIcon },
    ],
  },
  {
    id: "library",
    title: "말씀",
    items: [
      { id: "library", label: "말씀 서고", href: "/library", icon: BooksIcon },
      { id: "search", label: "말씀 검색", href: "/search", icon: MagnifyingGlassIcon },
    ],
  },
  {
    id: "garden",
    title: "나의 정원",
    items: [
      { id: "garden", label: "나의 정원", href: "/garden", icon: PlantIcon },
      {
        id: "bookmarks",
        label: "나의 책갈피",
        href: "/bookmarks",
        icon: BookmarksSimpleIcon,
        isAvailable: isHoondokCardsEnabled,
      },
      { id: "family", label: "가족·친구", href: "/family", icon: UsersThreeIcon, isAvailable: isComingSoon },
      { id: "settings", label: "알림·설치", href: "/settings", icon: BellSimpleIcon },
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
