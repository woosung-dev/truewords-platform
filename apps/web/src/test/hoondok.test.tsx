import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("훈독 기능 플래그", () => {
  it("OFF(기본) 이면 /hoondok 레이아웃이 notFound 를 호출한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_ENABLED", "");
    vi.resetModules();
    const notFound = vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    vi.doMock("next/navigation", () => ({ notFound, usePathname: () => "/hoondok" }));
    const { default: Layout } = await import("../app/(hoondok)/hoondok/layout");
    expect(() => Layout({ children: null })).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("ON 이면 [data-app=hoondok] 스코프 래퍼로 감싼다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_ENABLED", "1");
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => "/hoondok" }));
    const { default: Layout } = await import("../app/(hoondok)/hoondok/layout");
    const { container } = render(Layout({ children: <p>본문</p> }));
    expect(container.querySelector('[data-app="hoondok"]')).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
  });

  it("noindex 헤더를 /hoondok 경로에만 걸고, self-host 폰트만 immutable 캐시다", async () => {
    const { default: config } = await import("../../next.config");
    const headers = await config.headers?.();
    const sources = headers?.map((h) => h.source);
    expect(sources).toEqual(expect.arrayContaining(["/hoondok", "/hoondok/:path*", "/hoondok/fonts/:path*"]));
    expect(sources?.some((s) => s === "/" || s === "/:path*")).toBe(false);
    for (const h of headers ?? []) {
      if (h.source === "/hoondok/fonts/:path*") {
        expect(h.headers).toEqual([{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
      } else {
        expect(h.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
      }
    }
  });
});

describe("훈독 탭 정의", () => {
  it("5탭 · href 유일 · 오늘 훈독만 활성", async () => {
    const { HOONDOK_TABS, activeTabId } = await import("../features/hoondok/tabs");
    expect(HOONDOK_TABS).toHaveLength(5);
    expect(new Set(HOONDOK_TABS.map((t) => t.href)).size).toBe(5);
    expect(HOONDOK_TABS.map((t) => t.label)).toEqual(["오늘 훈독", "AI 질문", "말씀", "가정예배", "나의 정원"]);
    expect(activeTabId("/hoondok/read")).toBe("today");
    expect(HOONDOK_TABS.filter((t) => !t.isDisabled).map((t) => t.id)).toEqual(["today"]);
  });
});

describe("훈독 컴포넌트", () => {
  it("권위 배지는 숫자 + 한국어 라벨, R 은 점선", async () => {
    const { AuthorityBadge } = await import("../components/hoondok");
    const { container } = render(
      <>
        <AuthorityBadge grade="O1" />
        <AuthorityBadge grade="R" />
      </>,
    );
    expect(screen.getByText("O1 공식 원문")).toHaveClass("badge--rank");
    expect(screen.getByText("권리 확인 중")).toHaveClass("badge--dashed");
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });

  it("미션 카드는 링크와 체크 버튼이 형제이고, 준비 중이면 둘 다 비활성", async () => {
    vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => "/hoondok" }));
    const { MissionCard } = await import("../components/hoondok");
    const { BookOpenText } = await import("lucide-react");
    render(
      <>
        <MissionCard
          kind="훈독하기 · 3분"
          title="A"
          meta="m"
          icon={BookOpenText}
          href="/hoondok/read"
          onToggle={() => {}}
        />
        <MissionCard kind="기도하기 · 1분" title="B" meta="m" icon={BookOpenText} isDisabled />
      </>,
    );
    const link = screen.getByRole("link", { name: /훈독하기/ });
    expect(link).toHaveAttribute("href", "/hoondok/read");
    expect(link.querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "훈독하기 · 3분 완료" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "기도하기 · 1분 완료" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /기도하기/ })).toBeNull();
  });

  it("말씀 카드는 편성 없음 상태에서 대체 본문을 만들지 않는다 (AC-016-04)", async () => {
    const { MalssumCard } = await import("../components/hoondok");
    render(<MalssumCard status="none" />);
    expect(screen.getByRole("status")).toHaveTextContent("오늘 말씀이 아직 없어요");
    expect(document.querySelector(".scripture")).toBeNull();
  });

  it("KST 날짜 계산은 UTC 15:00 을 다음 날로 본다", async () => {
    const { formatKstDate } = await import("../features/hoondok/today");
    const { iso, weekday } = formatKstDate(new Date("2026-09-16T15:00:00Z"));
    expect(iso).toBe("2026-09-17");
    expect(weekday).toBe(4); // 2026-09-17 목
    expect(formatKstDate(new Date("2026-09-16T14:59:59Z")).iso).toBe("2026-09-16");
  });
});
