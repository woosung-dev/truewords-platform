import type { Icon } from "@phosphor-icons/react";
import { BooksIcon } from "@phosphor-icons/react/dist/ssr/Books";
import { ChatCircleDotsIcon } from "@phosphor-icons/react/dist/ssr/ChatCircleDots";
import { PlantIcon } from "@phosphor-icons/react/dist/ssr/Plant";
import { SunHorizonIcon } from "@phosphor-icons/react/dist/ssr/SunHorizon";
import { screenFor } from "./screens";

// 하단 4탭 = 상단 헤더의 단일 정의 (DES-PWA-003 §2.8, DEC-PWA-015 명칭).
// 공급이 정해지지 않은 5분 설교 탭은 빼고 평평한 4칸으로 둔다 (2026-11-03, 넷째 탭 리서치 선택지 2 · D3).
// 두 형태는 CSS(hoondok.css .nav) 만 다르고 이 목록 하나를 렌더한다.
export type HoondokTab = {
  id: "today" | "ask" | "library" | "garden";
  label: string;
  href: string;
  icon: Icon;
  /** 화면이 아직 없어 이동하지 않는다 — TAB_STAGE 로 산출 (준비 중 표시만) */
  isDisabled?: boolean;
};

/**
 * 탭 공개 단계 (PLAN-HD-002 W0-W).
 * live = 항상 이동 · soon = 준비 중.
 */
export const TAB_STAGE: Record<HoondokTab["id"], "live" | "soon"> = {
  today: "live",
  ask: "live",
  library: "live",
  garden: "live",
};

export function isTabEnabled(id: HoondokTab["id"]): boolean {
  return TAB_STAGE[id] === "live";
}

const TAB_DEFS: readonly Omit<HoondokTab, "isDisabled">[] = [
  { id: "today", label: "오늘 훈독", href: "/hoondok", icon: SunHorizonIcon },
  { id: "ask", label: "AI 질문", href: "/hoondok/ask", icon: ChatCircleDotsIcon },
  { id: "library", label: "말씀", href: "/hoondok/library", icon: BooksIcon },
  { id: "garden", label: "나의 정원", href: "/hoondok/garden", icon: PlantIcon },
];

// 단계는 고정값이라 모듈 상수로 한 번만 산출한다.
export const HOONDOK_TABS: readonly HoondokTab[] = TAB_DEFS.map((tab) => ({
  ...tab,
  isDisabled: !isTabEnabled(tab.id),
}));

/** pathname 이 어느 탭에 속하는지 — 화면 레지스트리(screens.ts) 의 탭 귀속을 따른다. */
export function activeTabId(pathname: string): HoondokTab["id"] {
  return screenFor(pathname).tabId;
}
