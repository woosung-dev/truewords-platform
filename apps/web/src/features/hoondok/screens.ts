import type { HoondokTab } from "./tabs";

// 화면 레지스트리 (PLAN-HD-002 W0-W). 앱바 제목·뒤로 링크·탭 귀속·본문 폭을 한 곳에서 정하고 앱 셸이 읽는다.
// 값의 원본은 프로토타입 app.html 의 TITLES·TAB_OF 맵과 각 화면의 `col--read` 여부다. 새 화면을 만드는 쪽은
// 이 목록에 한 줄만 더하고 tabs.ts·app-shell.tsx 는 건드리지 않는다.
export type HoondokScreen = {
  /** pathname 접두. 끝이 `/` 이면 그 아래 세그먼트만 잡고 자기 자신(`/ask`)은 잡지 않는다 */
  match: string;
  /** true 면 pathname 이 정확히 같을 때만 (홈) */
  exact?: boolean;
  title: string;
  /** 원문 API의 work_title 을 조회 후 앱바에 반영한다. title 은 로딩·오류 때의 기본값이다. */
  titleSource?: "work";
  /** 있을 때만 앱바에 뒤로 링크를 그린다. 탭 루트 화면은 없다 */
  backHref?: string;
  /** true 면 ← 가 앱 안 앞 기록이 있을 때 브라우저 뒤로(들어온 곳)로 간다. 없으면(바로 연 주소) backHref 로 간다 */
  backToHistory?: true;
  tabId: HoondokTab["id"];
  /**
   * 본문 폭. home = 홈(≥1024px 앱바 접힘) · read = 산문 640px(`col--read`) · app = 카드/리스트 720px.
   * 프로토타입에서 `col--read` 를 쓰는 화면만 read 다. onb = 질문 흐름 — 앱바를 시각적으로 접고(h1 은 보조기기용) 화면이 자기 머리를 그린다.
   */
  variant: "home" | "read" | "app" | "onb";
  /** true 면 앱바·헤더의 사람(관리)·종(알림센터) 아이콘을 함께 숨긴다. 탭 밖 흐름(온보딩 등)이다 */
  hideSettingsLink?: true;
  /** true 면 탭 내비를 그리지 않는다. 온보딩은 탭 진입 전이라 내비가 없다 (DES-PWA-003 §2) */
  hideNav?: true;
};

export const HOONDOK_SCREENS: readonly HoondokScreen[] = [
  { match: "/", exact: true, title: "오늘 훈독", tabId: "today", variant: "home" },
  { match: "/read", title: "훈독하기", backHref: "/", tabId: "today", variant: "read" },
  {
    match: "/onboarding",
    title: "시작하기",
    backHref: "/",
    tabId: "today",
    variant: "app",
    hideSettingsLink: true,
    hideNav: true,
  },
  // 맞춤 첫 말씀 질문 흐름 (환영 → 질문 1~3 → 첫 말씀). 탭바·헤더 없이 화면이 단계 머리를 그리므로 앱바 아이콘·뒤로 링크를 두지 않는다
  {
    match: "/start",
    title: "첫 말씀 고르기",
    tabId: "today",
    variant: "onb",
    hideSettingsLink: true,
    hideNav: true,
  },
  // 7일 정성 (읽기 정성 1a). 질문 흐름·읽기·마침표 모두 탭바 없이 화면이 자기 머리(PathTop)를 그린다
  {
    match: "/path",
    title: "정성 시작하기",
    tabId: "today",
    variant: "onb",
    hideSettingsLink: true,
    hideNav: true,
  },
  {
    match: "/path/read/",
    title: "오늘 읽을 장",
    tabId: "today",
    variant: "onb",
    hideSettingsLink: true,
    hideNav: true,
  },
  {
    match: "/path/done",
    title: "정성을 마쳤어요",
    tabId: "today",
    variant: "onb",
    hideSettingsLink: true,
    hideNav: true,
  },
  // 개인정보 처리방침 — 온보딩·설정·구글 동의 화면에서 들어온다. 들어온 곳으로 돌아가고, 바로 연 주소면 홈으로 간다.
  // 제목이 길어 좁은 화면에서 두 줄로 꺾이지 않게 검색 아이콘은 숨긴다
  {
    match: "/privacy",
    title: "개인정보 처리방침",
    backHref: "/",
    backToHistory: true,
    tabId: "garden",
    variant: "read",
  },
  {
    match: "/offline",
    title: "오프라인",
    backHref: "/",
    tabId: "today",
    variant: "app",
    hideSettingsLink: true,
  },
  // 오늘의 책갈피 (PLAN-HD-012, SCR-PWA-023·025·026). 받은 사람 화면(/c/{id})은 밖에서 들어오므로 뒤로 링크가 없다.
  { match: "/bookmark", title: "오늘의 책갈피", backHref: "/", tabId: "today", variant: "app" },
  { match: "/c/", title: "오늘의 책갈피", tabId: "today", variant: "app" },
  { match: "/bookmarks", title: "나의 책갈피", backHref: "/garden", tabId: "garden", variant: "app" },
  { match: "/garden", title: "나의 정원", tabId: "garden", variant: "app" },
  // 맞춤 말씀 (기본값 9·10). 둘 다 나의 정원에서 들어오고 본문은 설정형 560 (personal.css `.ps-form`)
  {
    match: "/garden/interests",
    title: "관심사와 마음",
    backHref: "/garden",
    tabId: "garden",
    variant: "app",
  },
  { match: "/pray", title: "마음 한 장", backHref: "/garden", tabId: "garden", variant: "app" },
  // 나의 기록 (C1). 기기 기록도 정원에서 들어오므로 뒤로는 정원이다
  { match: "/records", title: "나의 기록", backHref: "/garden", tabId: "garden", variant: "app" },
  {
    match: "/records/device",
    title: "이 기기에만 있는 기록",
    backHref: "/garden",
    tabId: "garden",
    variant: "app",
  },
  // 사람 아이콘(관리)·종(알림센터)이 가리키는 화면. 아이콘은 남기고 현재 위치만 표시한다(앱 셸 aria-current)
  { match: "/settings", title: "관리", backHref: "/", backToHistory: true, tabId: "garden", variant: "app" },
  { match: "/notifications", title: "알림센터", backHref: "/", backToHistory: true, tabId: "today", variant: "app" },
  // AI 질문 계열도 모바일 앱바에 말씀 검색을 둔다 — PC 헤더와 같게. 질문 검색(홈 돋보기)은 라벨이 "질문 검색"이라 구분된다.
  // /ask/log 는 홈 "내 질문" 탭으로 리다이렉트만 하므로 항목이 없다.
  { match: "/ask", title: "AI 질문", tabId: "ask", variant: "read" },
  // 새 질문은 전체 화면 — 앱바를 접고 화면이 ✕·제목·보내기 머리를 그린다
  {
    match: "/ask/new",
    title: "새 질문하기",
    tabId: "ask",
    variant: "onb",
    hideSettingsLink: true,
    hideNav: true,
  },
  {
    match: "/ask/p/",
    title: "공개 질문",
    backHref: "/ask",
    backToHistory: true,
    tabId: "ask",
    variant: "read",
  },
  { match: "/summaries", title: "AI 요약", backHref: "/library", tabId: "library", variant: "app" },
  { match: "/summaries/", title: "AI 요약", backHref: "/summaries", tabId: "library", variant: "app" },
  // /ask/{id} — new·p 가 아닌 세그먼트. 위 항목보다 접두가 짧아 최장 매치에서 자연히 밀린다
  {
    match: "/ask/",
    title: "질문",
    backHref: "/ask",
    backToHistory: true,
    tabId: "ask",
    variant: "read",
  },
  { match: "/library", title: "말씀", tabId: "library", variant: "app" },
  // /library/{series} — 저작물 한 건의 권 목록. 제목은 API-HD-023 의 저작물 제목으로 바뀐다
  {
    match: "/library/",
    title: "저작물",
    titleSource: "work",
    backHref: "/library",
    tabId: "library",
    variant: "app",
  },
  {
    match: "/search",
    title: "말씀 검색",
    tabId: "search",
    variant: "app",
  },
  {
    match: "/words",
    title: "원문 읽기",
    titleSource: "work",
    backHref: "/library",
    tabId: "library",
    variant: "read",
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
