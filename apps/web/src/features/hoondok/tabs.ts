import { BookOpenText, House, type LucideIcon, MessageCircle, Sprout, Sunrise } from "lucide-react";
import { isHoondokPreviewEnabled } from "./flag";
import { screenFor } from "./screens";

// 하단 5탭 = 상단 헤더 4 의 단일 정의 (DES-PWA-003 §7.1-3, DEC-PWA-015 명칭).
// 두 형태는 CSS(hoondok.css .nav) 만 다르고 이 목록 하나를 렌더한다.
export type HoondokTab = {
  id: "today" | "ask" | "library" | "worship" | "garden";
  label: string;
  href: string;
  icon: LucideIcon;
  /** 가운데 "말씀" 돌출 버블 (폰에서만 형태가 성립) */
  isMid?: boolean;
  /** 화면이 아직 없어 이동하지 않는다 — TAB_STAGE·프리뷰 플래그로 산출 (준비 중 표시만) */
  isDisabled?: boolean;
};

/**
 * 탭 공개 단계 (PLAN-HD-002 W0-W).
 * live = 항상 이동 · soon = 준비 중(플래그와 무관) · preview = NEXT_PUBLIC_HOONDOK_PREVIEW=1 에서만 이동.
 */
export const TAB_STAGE: Record<HoondokTab["id"], "live" | "soon" | "preview"> = {
  today: "live",
  ask: "live",
  library: "preview",
  worship: "preview",
  garden: "live",
};

export function isTabEnabled(id: HoondokTab["id"]): boolean {
  const stage = TAB_STAGE[id];
  return stage === "live" || (stage === "preview" && isHoondokPreviewEnabled());
}

const TAB_DEFS: readonly Omit<HoondokTab, "isDisabled">[] = [
  { id: "today", label: "오늘 훈독", href: "/hoondok", icon: Sunrise },
  { id: "ask", label: "AI 질문", href: "/hoondok/ask", icon: MessageCircle },
  { id: "library", label: "말씀", href: "/hoondok/library", icon: BookOpenText, isMid: true },
  { id: "worship", label: "가정예배", href: "/hoondok/worship", icon: House },
  { id: "garden", label: "나의 정원", href: "/hoondok/garden", icon: Sprout },
];

// 플래그는 빌드 시 인라인되므로 모듈 상수로 한 번만 산출한다.
export const HOONDOK_TABS: readonly HoondokTab[] = TAB_DEFS.map((tab) => ({
  ...tab,
  isDisabled: !isTabEnabled(tab.id),
}));

/** pathname 이 어느 탭에 속하는지 — 화면 레지스트리(screens.ts) 의 탭 귀속을 따른다. */
export function activeTabId(pathname: string): HoondokTab["id"] {
  return screenFor(pathname).tabId;
}
