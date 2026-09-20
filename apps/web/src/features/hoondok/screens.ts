import type { HoondokTab } from "./tabs";

// 화면 레지스트리 (PLAN-HD-002 W0-W). 앱바 제목·뒤로 링크·탭 귀속·본문 폭을 한 곳에서 정하고 앱 셸이 읽는다.
// 값의 원본은 프로토타입 app.html 의 TITLES·TAB_OF 맵과 각 화면의 `col--read` 여부다. 새 화면을 만드는 쪽은
// 이 목록에 한 줄만 더하고 tabs.ts·app-shell.tsx 는 건드리지 않는다.
export type HoondokScreen = {
  /** pathname 접두. 끝이 `/` 이면 그 아래 세그먼트만 잡고 자기 자신(`/hoondok/ask`)은 잡지 않는다 */
  match: string;
  /** true 면 pathname 이 정확히 같을 때만 (홈) */
  exact?: boolean;
  title: string;
  /** 있을 때만 앱바에 뒤로 링크를 그린다. 탭 루트 화면은 없다 */
  backHref?: string;
  tabId: HoondokTab["id"];
  /**
   * 본문 폭. home = 홈(≥1024px 앱바 접힘) · read = 산문 640px(`col--read`) · app = 카드/리스트 720px.
   * 프로토타입에서 `col--read` 를 쓰는 화면만 read 다.
   */
  variant: "home" | "read" | "app";
};

export const HOONDOK_SCREENS: readonly HoondokScreen[] = [
  { match: "/hoondok", exact: true, title: "오늘 훈독", tabId: "today", variant: "home" },
  { match: "/hoondok/read", title: "훈독하기", backHref: "/hoondok", tabId: "today", variant: "read" },
  { match: "/hoondok/onboarding", title: "시작하기", backHref: "/hoondok", tabId: "today", variant: "app" },
  { match: "/hoondok/offline", title: "오프라인", backHref: "/hoondok", tabId: "today", variant: "app" },
  { match: "/hoondok/garden", title: "나의 정원", tabId: "garden", variant: "app" },
  { match: "/hoondok/settings", title: "알림·설치", backHref: "/hoondok/garden", tabId: "garden", variant: "app" },
  { match: "/hoondok/family", title: "가족·친구", backHref: "/hoondok/garden", tabId: "garden", variant: "app" },
  { match: "/hoondok/ask", title: "AI 질문", tabId: "ask", variant: "read" },
  { match: "/hoondok/ask/log", title: "질문 기록", backHref: "/hoondok/ask", tabId: "ask", variant: "read" },
  // /hoondok/ask/{id} — log 가 아닌 세그먼트. 위 항목보다 접두가 짧아 최장 매치에서 자연히 밀린다
  { match: "/hoondok/ask/", title: "질문", backHref: "/hoondok/ask/log", tabId: "ask", variant: "read" },
  { match: "/hoondok/library", title: "말씀", tabId: "library", variant: "app" },
  { match: "/hoondok/search", title: "말씀 검색", backHref: "/hoondok/library", tabId: "library", variant: "app" },
  { match: "/hoondok/words", title: "천성경 1편 3장", backHref: "/hoondok/library", tabId: "library", variant: "read" },
  { match: "/hoondok/worship", title: "가정예배", tabId: "worship", variant: "app" },
  {
    match: "/hoondok/worship/challenge",
    title: "챌린지",
    backHref: "/hoondok/worship",
    tabId: "worship",
    variant: "app",
  },
  {
    match: "/hoondok/worship/sermons",
    title: "5분 설교",
    backHref: "/hoondok/worship",
    tabId: "worship",
    variant: "app",
  },
  {
    match: "/hoondok/worship/request",
    title: "설교 섭외",
    backHref: "/hoondok/worship/sermons",
    tabId: "worship",
    variant: "app",
  },
];

const HOME_SCREEN = HOONDOK_SCREENS[0];

function isMatch(screen: HoondokScreen, pathname: string): boolean {
  if (screen.exact) return pathname === screen.match;
  if (pathname === screen.match) return true;
  const prefix = screen.match.endsWith("/") ? screen.match : `${screen.match}/`;
  return pathname.startsWith(prefix);
}

/** pathname 에 맞는 화면. 여러 개면 접두가 가장 긴 것, 없으면 홈 항목이다. */
export function screenFor(pathname: string): HoondokScreen {
  let best: HoondokScreen | undefined;
  for (const screen of HOONDOK_SCREENS) {
    if (isMatch(screen, pathname) && (!best || screen.match.length > best.match.length)) best = screen;
  }
  return best ?? HOME_SCREEN;
}
