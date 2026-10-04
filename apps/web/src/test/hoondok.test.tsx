import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("훈독 경로 헤더: noindex 전체 · 폰트 immutable · sw.js·manifest no-cache · sw.js Service-Worker-Allowed", async () => {
    const { default: config } = await import("../../next.config");
    const headers = (await config.headers?.()) ?? [];
    const bySource = new Map(
      headers.map((h) => [h.source, Object.fromEntries(h.headers.map((x) => [x.key, x.value]))] as const),
    );
    // 시연 챗 경로(/, /login …)에는 어떤 헤더 규칙도 없다
    for (const source of bySource.keys()) expect(source.startsWith("/hoondok")).toBe(true);
    expect(bySource.get("/hoondok")).toEqual({ "X-Robots-Tag": "noindex, nofollow" });
    expect(bySource.get("/hoondok/:path*")).toEqual({ "X-Robots-Tag": "noindex, nofollow" });
    expect(bySource.get("/hoondok/fonts/:path*")).toEqual({ "Cache-Control": "public, max-age=31536000, immutable" });
    expect(bySource.get("/hoondok/sw.js")).toEqual({
      "Cache-Control": "no-cache, must-revalidate",
      "Service-Worker-Allowed": "/hoondok",
    });
    expect(bySource.get("/hoondok/manifest.webmanifest")).toEqual({ "Cache-Control": "no-cache, must-revalidate" });
  });
});

describe("훈독 탭 정의", () => {
  it("5탭 · href 유일 · 오늘 훈독·AI 질문·나의 정원 활성", async () => {
    const { HOONDOK_TABS, activeTabId } = await import("../features/hoondok/tabs");
    expect(HOONDOK_TABS).toHaveLength(5);
    expect(new Set(HOONDOK_TABS.map((t) => t.href)).size).toBe(5);
    expect(HOONDOK_TABS.map((t) => t.label)).toEqual(["오늘 훈독", "AI 질문", "말씀", "5분 설교", "나의 정원"]);
    expect(activeTabId("/hoondok/read")).toBe("today");
    expect(HOONDOK_TABS.filter((t) => !t.isDisabled).map((t) => t.id)).toEqual(["today", "ask", "library", "garden"]);
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

  it("미션 카드는 링크와 체크 버튼이 형제이고, 준비 중이면 링크도 체크도 없다", async () => {
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
    // 누를 수 없는 체크를 그리지 않는다 — 비활성 원이 할 일처럼 보이지 않게
    expect(screen.queryByRole("button", { name: "기도하기 · 1분 완료" })).toBeNull();
    expect(screen.queryByRole("link", { name: /기도하기/ })).toBeNull();
  });

  it("이번 주 스트립: 완료 칸은 체크 아이콘과 '완료' 를 읽고, 완료하지 않은 칸은 요일 글자만 둔다", async () => {
    const { WeekStrip } = await import("../components/hoondok");
    // 3 = 수요일 → 월요일 시작 세 번째 칸이 오늘
    const { container } = render(<WeekStrip todayWeekday={3} doneByDay={[true, false, true]} />);
    const days = container.querySelectorAll(".week__day");
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveTextContent("월 완료");
    expect(days[0]?.querySelector("svg")).not.toBeNull();
    expect(days[1]).toHaveTextContent(/^화$/);
    expect(days[1]?.querySelector("svg")).toBeNull();
    expect(days[2]).toHaveAttribute("aria-current", "date");
    expect(days[2]).toHaveTextContent("수 오늘 완료");
  });

  it("말씀 전문의 제목이 본문 첫 문장을 자른 것이면 제목은 보조기기에만 남긴다", async () => {
    const { MalssumCard } = await import("../components/hoondok");
    const { isTitleEcho } = await import("../components/hoondok/malssum-card");
    expect(isTitleEcho("하나님은 참사랑의 근본이시니…", "하나님은 참사랑의 근본이시니 그 사랑으로")).toBe(true);
    expect(isTitleEcho("참사랑의 근본", "하나님은 참사랑의 근본이시니")).toBe(false);
    expect(isTitleEcho("…", "본문")).toBe(false);

    const reading = {
      id: "r1",
      reading_date: "2026-10-05",
      title: "하나님은 참사랑의 근본이시니…",
      body: "하나님은 참사랑의 근본이시니 그 사랑으로 세상을 지으셨다.",
      speaker: "화자",
      spoken_on: null,
      work_title: "정본",
      edition: "판본",
      authority_grade: "O1",
      review_status: "unverified",
      estimated_minutes: 3,
    } as const;
    const { rerender } = render(<MalssumCard status="available" reading={reading} isFull />);
    // 글 이름표는 그대로 — 화면에서만 숨긴다
    expect(screen.getByRole("article", { name: reading.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: reading.title })).toHaveClass("sr-only");
    // 검수 전은 점선 배지가 아니라 출처 줄 글자다
    expect(screen.getByText("검수 전")).toHaveClass("src__part");

    rerender(<MalssumCard status="available" reading={{ ...reading, title: "오늘의 말씀" }} isFull />);
    expect(screen.getByRole("heading", { name: "오늘의 말씀" })).not.toHaveClass("sr-only");
  });

  it("상태 상자는 조회 실패일 때만 다시 불러오기 버튼을 둔다", async () => {
    const { StatusBox } = await import("../features/hoondok/components/status-box");
    const onRetry = vi.fn();
    const { rerender } = render(<StatusBox onRetry={onRetry}>오늘 편성을 불러오지 못했어요.</StatusBox>);
    expect(screen.getByRole("status")).toHaveTextContent("오늘 편성을 불러오지 못했어요.");
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(<StatusBox>오늘은 일반 편성을 보여 드려요.</StatusBox>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("말씀 카드는 편성 없음 상태에서 대체 본문을 만들지 않는다 (AC-016-04)", async () => {
    const { MalssumCard } = await import("../components/hoondok");
    render(<MalssumCard status="none" />);
    expect(screen.getByRole("status")).toHaveTextContent("오늘은 정해진 말씀이 없어요");
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

// hoondok.css 원문 검사 — 브라우저에서만 드러나는 두 결함의 회귀를 막는다.
describe("훈독 CSS 원문", () => {
  const HOONDOK_CSS = readFileSync(path.resolve(__dirname, "../app/hoondok.css"), "utf8");

  it("미션 제목은 .ql-q 와 같이 두 줄에서 자른다", () => {
    const rule = HOONDOK_CSS.match(/\.mission__title\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/display:\s*-webkit-box;/);
    expect(rule).toMatch(/-webkit-box-orient:\s*vertical;/);
    expect(rule).toMatch(/-webkit-line-clamp:\s*2;/);
    expect(rule).toMatch(/overflow:\s*hidden;/);
  });
});

// reduced-motion 에서도 유지되는 스피너 (DES-PWA-003 §1.5).
// globals.css 의 `@layer base` 안에 `* { animation-duration: 0.01ms !important;
// animation-iteration-count: 1 !important }` 가 있고, 캐스케이드 레이어에서 !important 는
// 우선순위가 뒤집혀 레이어 안이 레이어 밖을 이긴다. 되살림 규칙이 레이어 밖으로 나가는 순간
// 스피너는 다시 0.01ms × 1회 로 멈춘다 — import 순서로는 되돌릴 수 없다.
describe("reduced-motion 스피너 되살림", () => {
  const WEB_ROOT = path.resolve(__dirname, "../..");
  const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

  /** index 를 감싸는 최상위 `@layer <name>` 의 이름. 레이어 밖이면 null. 주석은 걷어낸 뒤 넘긴다. */
  function enclosingLayer(css: string, index: number) {
    for (const match of css.matchAll(/@layer\s+([\w-]+)\s*\{/g)) {
      const start = match.index;
      let depth = 1;
      let i = start + match[0].length;
      while (i < css.length && depth > 0) {
        if (css[i] === "{") depth += 1;
        else if (css[i] === "}") depth -= 1;
        i += 1;
      }
      if (index > start && index < i) return match[1];
    }
    return null;
  }

  it.each([
    ["src/app/hoondok.css", ".btn__spinner"],
    ["src/app/_hoondok/ask.css", ".ask-spinner"],
  ])("%s 의 %s 되살림은 @layer base 안 · 스코프 아래에 있다", (file, selector) => {
    const css = stripComments(readFileSync(path.join(WEB_ROOT, file), "utf8"));
    const nesting = new RegExp(
      [
        "@layer\\s+base\\s*\\{",
        '\\s*\\[data-app="hoondok"\\]\\s*\\{',
        "\\s*@media\\s*\\(prefers-reduced-motion:\\s*reduce\\)\\s*\\{",
        `\\s*${selector.replace(".", "\\.")}\\s*\\{`,
        "\\s*animation:\\s*hoondok-spin\\s+1\\.2s\\s+linear\\s+infinite\\s*!important;",
      ].join(""),
    );
    expect(css).toMatch(nesting);

    // 되살림은 파일당 하나뿐이고, 그 하나가 base 레이어 안에 있어야 한다.
    const revivals = [...css.matchAll(/animation:\s*hoondok-spin[^;]*!important/g)];
    expect(revivals).toHaveLength(1);
    expect(enclosingLayer(css, revivals[0].index)).toBe("base");
  });

  it("globals.css 의 reduced-motion 포괄 규칙이 @layer base 안에 있다 (되살림을 레이어에 둔 이유)", () => {
    const css = stripComments(readFileSync(path.join(WEB_ROOT, "src/app/globals.css"), "utf8"));
    const index = css.indexOf("animation-iteration-count: 1 !important");
    expect(index).toBeGreaterThan(-1);
    expect(enclosingLayer(css, index)).toBe("base");
  });
});
