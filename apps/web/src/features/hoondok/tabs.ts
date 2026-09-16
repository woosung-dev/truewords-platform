import { BookOpenText, House, type LucideIcon, MessageCircle, Sprout, Sunrise } from "lucide-react";

// 하단 5탭 = 상단 헤더 4 의 단일 정의 (DES-PWA-003 §7.1-3, DEC-PWA-015 명칭).
// 두 형태는 CSS(hoondok.css .nav) 만 다르고 이 목록 하나를 렌더한다.
export type HoondokTab = {
  id: "today" | "ask" | "library" | "worship" | "garden";
  label: string;
  href: string;
  icon: LucideIcon;
  /** 가운데 "말씀" 돌출 버블 (폰에서만 형태가 성립) */
  isMid?: boolean;
  /** Phase 1 에는 화면이 없어 이동하지 않는다 [가정: 준비 중 표시만] */
  isDisabled?: boolean;
};

export const HOONDOK_TABS: readonly HoondokTab[] = [
  { id: "today", label: "오늘 훈독", href: "/hoondok", icon: Sunrise },
  { id: "ask", label: "AI 질문", href: "/hoondok/ask", icon: MessageCircle, isDisabled: true },
  { id: "library", label: "말씀", href: "/hoondok/library", icon: BookOpenText, isMid: true, isDisabled: true },
  { id: "worship", label: "가정예배", href: "/hoondok/worship", icon: House, isDisabled: true },
  { id: "garden", label: "나의 정원", href: "/hoondok/garden", icon: Sprout, isDisabled: true },
];

/** pathname 이 어느 탭에 속하는지. /hoondok/read 는 "오늘 훈독" 탭 아래다. */
export function activeTabId(pathname: string): HoondokTab["id"] {
  const hit = HOONDOK_TABS.find((tab) => tab.id !== "today" && pathname.startsWith(tab.href));
  return hit?.id ?? "today";
}
