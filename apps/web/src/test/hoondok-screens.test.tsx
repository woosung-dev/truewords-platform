import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 화면 레지스트리·탭 단계·앱 셸 (PLAN-HD-002 W0-W). 프리뷰 플래그는 모듈 평가 시 읽히므로 stubEnv 뒤 재import 한다.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function loadTabsWithPreview(value: "" | "1") {
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", value);
  vi.resetModules();
  return import("../features/hoondok/tabs");
}

describe("훈독 화면 레지스트리", () => {
  it("제목·뒤로·탭·폭은 프로토타입 TITLES·TAB_OF·col--read 를 따른다", async () => {
    const { screenFor } = await import("../features/hoondok/screens");
    const pick = (pathname: string) => {
      const s = screenFor(pathname);
      return [s.title, s.backHref, s.tabId, s.variant];
    };
    expect(pick("/hoondok")).toEqual(["오늘 훈독", undefined, "today", "home"]);
    expect(pick("/hoondok/read")).toEqual(["훈독하기", "/hoondok", "today", "read"]);
    expect(pick("/hoondok/onboarding")).toEqual(["시작하기", "/hoondok", "today", "app"]);
    expect(pick("/hoondok/garden")).toEqual(["나의 정원", undefined, "garden", "app"]);
    expect(pick("/hoondok/settings")).toEqual(["알림·설치", "/hoondok/garden", "garden", "app"]);
    expect(pick("/hoondok/family")).toEqual(["가족·친구", "/hoondok/garden", "garden", "app"]);
    expect(pick("/hoondok/ask")).toEqual(["AI 질문", undefined, "ask", "read"]);
    expect(pick("/hoondok/ask/log")).toEqual(["질문 기록", "/hoondok/ask", "ask", "read"]);
    expect(pick("/hoondok/ask/q-123")).toEqual(["질문", "/hoondok/ask/log", "ask", "read"]);
    expect(pick("/hoondok/search")).toEqual(["말씀 검색", "/hoondok/library", "library", "app"]);
    expect(pick("/hoondok/words")).toEqual(["천성경 1편 3장", "/hoondok/library", "library", "read"]);
    expect(pick("/hoondok/worship/request")).toEqual(["설교 섭외", "/hoondok/worship/sermons", "worship", "app"]);
    // 미등록 경로는 홈 항목으로 떨어진다
    expect(pick("/hoondok/unknown")).toEqual(["오늘 훈독", undefined, "today", "home"]);
  });

  it("activeTabId 는 하위 화면을 상위 탭에 귀속한다", async () => {
    const { activeTabId } = await import("../features/hoondok/tabs");
    expect(activeTabId("/hoondok/read")).toBe("today");
    expect(activeTabId("/hoondok/settings")).toBe("garden");
    expect(activeTabId("/hoondok/family")).toBe("garden");
    expect(activeTabId("/hoondok/search")).toBe("library");
    expect(activeTabId("/hoondok/worship/sermons")).toBe("worship");
  });
});

describe("훈독 탭 단계 · 프리뷰 플래그", () => {
  it("OFF(기본): 오늘 훈독·AI 질문·나의 정원만 이동한다", async () => {
    const { HOONDOK_TABS, TAB_STAGE } = await loadTabsWithPreview("");
    expect(HOONDOK_TABS.filter((t) => !t.isDisabled).map((t) => t.id)).toEqual(["today", "ask", "garden"]);
    expect(TAB_STAGE).toEqual({ today: "live", garden: "live", ask: "live", library: "preview", worship: "preview" });
  });

  it("ON: 말씀·가정예배가 켜져 5탭이 모두 이동한다", async () => {
    const { HOONDOK_TABS, isTabEnabled } = await loadTabsWithPreview("1");
    expect(HOONDOK_TABS.filter((t) => !t.isDisabled).map((t) => t.id)).toEqual([
      "today",
      "ask",
      "library",
      "worship",
      "garden",
    ]);
    expect(isTabEnabled("ask")).toBe(true);
  });
});

describe("훈독 앱 셸", () => {
  it("/hoondok/settings: 제목 알림·설치 · 뒤로 → /hoondok/garden · 정원 탭 활성 · 검색은 장식", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", "");
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => "/hoondok/settings" }));
    const { HoondokAppShell } = await import("../components/hoondok/app-shell");
    const { container } = render(
      <HoondokAppShell>
        <p>본문</p>
      </HoondokAppShell>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("알림·설치");
    expect(screen.getByRole("link", { name: "뒤로" })).toHaveAttribute("href", "/hoondok/garden");
    expect(screen.getByRole("link", { name: /나의 정원/ })).toHaveAttribute("aria-current", "page");
    expect(container.querySelector("main")).toHaveClass("app__main--app");
    expect(screen.queryByRole("link", { name: "말씀 검색" })).toBeNull();
  });

  it("프리뷰 ON: 앱바 아이콘·헤더 검색이 /hoondok/search 링크가 된다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", "1");
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => "/hoondok" }));
    const { HoondokAppShell } = await import("../components/hoondok/app-shell");
    render(
      <HoondokAppShell>
        <p>본문</p>
      </HoondokAppShell>,
    );
    const links = screen.getAllByRole("link", { name: "말씀 검색" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/hoondok/search");
    expect(screen.queryByRole("link", { name: "뒤로" })).toBeNull();
  });
});
