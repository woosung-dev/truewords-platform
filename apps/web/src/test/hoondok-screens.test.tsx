import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 화면 레지스트리·탭 단계·앱 셸 (PLAN-HD-002 W0-W).
afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("훈독 화면 레지스트리", () => {
  it("제목·뒤로·탭·폭은 프로토타입 TITLES·TAB_OF·col--read 를 따른다", async () => {
    const { screenFor } = await import("../features/hoondok/screens");
    const pick = (pathname: string) => {
      const s = screenFor(pathname);
      return [s.title, s.backHref, s.tabId, s.variant];
    };
    expect(pick("/")).toEqual(["오늘 훈독", undefined, "today", "home"]);
    expect(pick("/read")).toEqual(["훈독하기", "/", "today", "read"]);
    expect(pick("/onboarding")).toEqual(["시작하기", "/", "today", "app"]);
    expect(pick("/garden")).toEqual(["나의 정원", undefined, "garden", "app"]);
    expect(pick("/settings")).toEqual(["알림·설치", "/garden", "garden", "app"]);
    expect(pick("/ask")).toEqual(["AI 질문", undefined, "ask", "read"]);
    expect(pick("/ask/new")).toEqual(["새 질문하기", undefined, "ask", "onb"]);
    expect(pick("/ask/q-123")).toEqual(["질문", "/ask", "ask", "read"]);
    expect(pick("/ask/p/pq1")).toEqual(["공개 질문", "/ask", "ask", "read"]);
    // AI 질문 계열도 앱바에 말씀 검색을 둔다(PC 헤더와 같게). 앱바를 접는 새 질문 화면만 숨긴다
    for (const pathname of ["/ask", "/ask/q-123", "/ask/p/pq1"])
      expect(screenFor(pathname).hideSearchLink).toBeUndefined();
    expect(screenFor("/ask/new").hideSearchLink).toBe(true);
    expect(pick("/search")).toEqual(["말씀 검색", "/library", "library", "app"]);
    expect(pick("/words")).toEqual(["원문 읽기", "/library", "library", "read"]);
    // 미등록 경로는 홈 항목으로 떨어진다
    expect(pick("/hoondok/unknown")).toEqual(["오늘 훈독", undefined, "today", "home"]);
  });

  it("activeTabId 는 하위 화면을 상위 탭에 귀속한다", async () => {
    const { activeTabId } = await import("../features/hoondok/tabs");
    expect(activeTabId("/read")).toBe("today");
    expect(activeTabId("/settings")).toBe("garden");
    expect(activeTabId("/search")).toBe("library");
  });
});

describe("훈독 탭 단계", () => {
  it("4탭 모두 이동한다", async () => {
    const { HOONDOK_TABS, TAB_STAGE } = await import("../features/hoondok/tabs");
    expect(HOONDOK_TABS.filter((t) => !t.isDisabled).map((t) => t.id)).toEqual(["today", "ask", "library", "garden"]);
    expect(TAB_STAGE).toEqual({ today: "live", garden: "live", ask: "live", library: "live" });
  });
});

describe("훈독 앱 셸", () => {
  it("답 화면 ← 는 앱 안 앞 기록이 있으면 들어온 곳으로, 바로 연 주소면 AI 질문 홈으로 간다", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => "/ask/q-123" }));
    const { HoondokAppShell } = await import("../components/hoondok/app-shell");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(<HoondokAppShell>본문</HoondokAppShell>);
    const link = screen.getByRole("link", { name: "뒤로" });
    expect(link).toHaveAttribute("href", "/ask");

    expect(fireEvent.click(link)).toBe(true);
    expect(back).not.toHaveBeenCalled();

    window.history.pushState({}, "", window.location.href);
    expect(fireEvent.click(link)).toBe(false);
    expect(back).toHaveBeenCalledOnce();
  });

  it("고정 내비게이션에 가려진 입력 초점만 가운데로 옮긴다", async () => {
    vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => "/read" }));
    const { HoondokAppShell } = await import("../components/hoondok/app-shell");
    render(
      <HoondokAppShell>
        <textarea aria-label="한 줄" />
      </HoondokAppShell>,
    );
    const input = screen.getByRole("textbox", { name: "한 줄" });
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 700, 335, 102));
    vi.spyOn(input, "matches").mockReturnValue(true);
    const scroll = vi.spyOn(input, "scrollIntoView");
    const hit = vi.fn(() => screen.getByRole("navigation", { name: "주 메뉴" }));
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
    try {
      fireEvent.focus(input);
      expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "instant" });
      scroll.mockClear();
      hit.mockReturnValue(input as unknown as HTMLElement);
      fireEvent.focus(input);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
  });

  it("/settings: 제목 알림·설치 · 뒤로 → /garden · 정원 탭 활성 · 검색은 항상 활성", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => "/settings" }));
    const { HoondokAppShell } = await import("../components/hoondok/app-shell");
    const { container } = render(
      <HoondokAppShell>
        <p>본문</p>
      </HoondokAppShell>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("알림·설치");
    expect(screen.getByRole("link", { name: "뒤로" })).toHaveAttribute("href", "/garden");
    expect(screen.getByRole("link", { name: /나의 정원/ })).toHaveAttribute("aria-current", "page");
    expect(container.querySelector("main")).toHaveClass("app__main--app");
    expect(screen.getAllByRole("link", { name: "말씀 검색" })).toHaveLength(2);
  });

  it("홈: 앱바 아이콘·헤더 검색이 /search 링크가 된다", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => "/" }));
    const { HoondokAppShell } = await import("../components/hoondok/app-shell");
    render(
      <HoondokAppShell>
        <p>본문</p>
      </HoondokAppShell>,
    );
    const links = screen.getAllByRole("link", { name: "말씀 검색" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/search");
    expect(screen.queryByRole("link", { name: "뒤로" })).toBeNull();
  });
});

describe("훈독 알림·설치 도달 경로 · 온보딩 탭바", () => {
  async function shell(pathname: string) {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => pathname }));
    const { HoondokAppShell } = await import("../components/hoondok/app-shell");
    return render(
      <HoondokAppShell>
        <p>본문</p>
      </HoondokAppShell>,
    );
  }

  it("홈: 앱바 아이콘과 헤더 계정 자리 둘 다 /settings 로 간다", async () => {
    await shell("/");
    const links = screen.getAllByRole("link", { name: "알림·설치" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/settings");
  });

  it("검색 화면 자신에서는 앱바 검색 아이콘을 숨기고 헤더 검색 자리를 현재 위치로 표시한다", async () => {
    await shell("/search");
    const links = screen.getAllByRole("link", { name: "말씀 검색" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveClass("nav__search");
    expect(links[0]).toHaveAttribute("aria-current", "page");
  });

  it("AI 질문도 앱바·헤더 둘 다 말씀 검색이 있고, 현재 위치로 표시하지 않는다", async () => {
    await shell("/ask");
    const links = screen.getAllByRole("link", { name: "말씀 검색" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).not.toHaveAttribute("aria-current");
  });

  it("온보딩·검색·오프라인·새 질문·알림 설정 자신에는 알림 아이콘이 없다", async () => {
    for (const pathname of ["/onboarding", "/search", "/offline", "/ask/new", "/settings"]) {
      const view = await shell(pathname);
      expect(screen.queryByRole("link", { name: "알림·설치" })).toBeNull();
      view.unmount();
    }
  });

  it("온보딩은 탭 진입 전이라 탭 내비를 그리지 않는다 (DES-PWA-003 §2)", async () => {
    await shell("/onboarding");
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("시작하기");
  });
});
