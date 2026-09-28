import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 앱바 햄버거 → 전체 메뉴 드로어 + 즐겨찾기 (밀리의 서재 즐겨찾기 패널 벤치마크, 2026-09-29).
// 즐겨찾기는 이 기기 localStorage 에만 둔다 — 서버 요청 없이 동작해야 하고, 저장소가 깨져도 메뉴는 열린다.

let pathname = "/hoondok/garden";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/features/hoondok/library/api", async (original) => ({
  ...(await original<object>()),
  libraryAPI: { list: vi.fn() },
}));

import { HoondokAppShell } from "@/components/hoondok";
import { libraryAPI } from "@/features/hoondok/library/api";
import { parseFavorites } from "@/features/hoondok/menu/favorites";

const KEY = "hoondok:favorites";
const WORK = {
  series: "천성경",
  title: "천성경",
  volume_count: 3,
  allowed_count: 3,
  authority_grade: "O1" as const,
  scope_search: true,
  scope_full_text: true,
};

function show(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

// 매번 새 엘리먼트를 만든다 — 같은 객체로 rerender 하면 React 가 셸을 다시 그리지 않아 바뀐 경로를 읽지 않는다
const shell = () => (
  <HoondokAppShell>
    <p>본문</p>
  </HoondokAppShell>
);

function openMenu() {
  const view = show(shell());
  // 폰 앱바 버튼과 PC 헤더 버튼이 같은 이름이다 — 폭 전환은 CSS 가 맡는다
  const opener = screen.getAllByRole("button", { name: "전체 메뉴" })[0];
  opener.focus();
  fireEvent.click(opener);
  return Object.assign(screen.getByRole("dialog", { name: "전체 메뉴" }), { view });
}

function favBand(dialog: HTMLElement, title: string) {
  const heading = within(dialog).getByRole("heading", { name: title });
  return heading.closest(".mn-fav") as HTMLElement;
}

beforeEach(() => {
  pathname = "/hoondok/garden";
  window.localStorage.clear();
  vi.mocked(libraryAPI.list).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("즐겨찾기 저장값", () => {
  it("깨진 JSON·모양이 틀린 항목은 버리고 나머지는 살린다", () => {
    expect(parseFavorites("{not json")).toEqual({ menu: [], works: [] });
    expect(
      parseFavorites(
        JSON.stringify({
          menu: ["ask", 3, "ask", "garden"],
          works: [{ series: "천성경", title: "천성경" }, { series: "" }, { series: "천성경", title: "중복" }],
        }),
      ),
    ).toEqual({ menu: ["ask", "garden"], works: [{ series: "천성경", title: "천성경" }] });
  });
});

describe("전체 메뉴 드로어", () => {
  it("햄버거로 열고, 닫으면 여는 버튼으로 포커스가 돌아온다", async () => {
    const dialog = openMenu();
    expect(dialog).toHaveAttribute("open");
    // 목록은 하단 5탭과 같은 묶음 순서다
    const groups = within(dialog)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(groups).toEqual(["즐겨찾는 메뉴", "즐겨찾는 말씀", "오늘 훈독", "AI 질문", "말씀", "가정예배", "나의 정원"]);

    // 읽기는 제목에서 시작한다
    expect(document.activeElement).toBe(within(dialog).getByRole("heading", { name: "전체 메뉴" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "전체 메뉴 닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getAllByRole("button", { name: "전체 메뉴" })[0]);
  });

  it("드로어 밖에서 경로가 바뀌면(뒤로 가기) 새 화면 위에 남지 않고 닫힌다", () => {
    const { view } = openMenu();
    pathname = "/hoondok/ask";
    view.rerender(<QueryClientProvider client={new QueryClient()}>{shell()}</QueryClientProvider>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("프리뷰가 꺼진 가정예배는 숨기지 않고 '준비 중' 으로 남기며 별이 없다", () => {
    const dialog = openMenu();
    const worship = within(dialog).getByRole("heading", { name: "가정예배" }).closest("section") as HTMLElement;
    expect(within(worship).getAllByText("준비 중")).toHaveLength(3);
    expect(within(worship).queryByRole("link")).toBeNull();
    expect(within(worship).queryByRole("button", { name: /즐겨찾기/ })).toBeNull();
  });

  it("별을 누르면 위 띠에 칩이 생기고 기기에 남는다. 초기화 뒤 되돌리기로 복구된다", () => {
    const dialog = openMenu();
    const band = favBand(dialog, "즐겨찾는 메뉴");
    expect(within(band).getByRole("button", { name: "즐겨찾는 메뉴 초기화" })).toBeDisabled();

    const star = within(dialog).getByRole("button", { name: "질문하기 즐겨찾기" });
    fireEvent.click(star);
    expect(star).toHaveAttribute("aria-pressed", "true");
    expect(within(band).getByRole("link", { name: "질문하기" })).toHaveAttribute("href", "/hoondok/ask");
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}")).toEqual({ menu: ["ask"], works: [] });

    fireEvent.click(within(band).getByRole("button", { name: "즐겨찾는 메뉴 초기화" }));
    expect(within(band).queryByRole("link")).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(within(dialog).getByRole("status")).toHaveTextContent("즐겨찾는 메뉴를 비웠어요");
    // 누른 초기화가 막히므로 포커스는 되돌리기로, 되돌린 뒤에는 다시 초기화로 온다 — 패널 밖으로 새지 않는다
    const undo = within(dialog).getByRole("button", { name: "되돌리기" });
    expect(document.activeElement).toBe(undo);

    fireEvent.click(undo);
    expect(within(band).getByRole("link", { name: "질문하기" })).toBeInTheDocument();
    expect(document.activeElement).toBe(within(band).getByRole("button", { name: "즐겨찾는 메뉴 초기화" }));
  });

  it("메뉴 탭만 볼 때는 서고를 요청하지 않고, 말씀 탭에서 저작물을 즐겨찾기한다", async () => {
    vi.mocked(libraryAPI.list).mockResolvedValue({ items: [], works: [WORK] });
    const dialog = openMenu();
    expect(libraryAPI.list).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("tab", { name: "말씀" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "천성경 즐겨찾기" }));
    const band = favBand(dialog, "즐겨찾는 말씀");
    expect(within(band).getByRole("link", { name: "천성경" })).toHaveAttribute(
      "href",
      `/hoondok/library/${encodeURIComponent("천성경")}`,
    );
  });

  it("서고 목록을 받지 못하면 이유와 다시 시도를 보인다", async () => {
    vi.mocked(libraryAPI.list).mockRejectedValue(new Error("offline"));
    const dialog = openMenu();
    fireEvent.click(within(dialog).getByRole("tab", { name: "말씀" }));
    expect(await within(dialog).findByText(/저작물 목록을 불러오지 못했어요/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("저장소 접근이 막혀도 메뉴는 열리고 비어 있는 안내를 보인다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const dialog = openMenu();
    expect(within(dialog).getByText("별을 누르면 자주 여는 메뉴가 여기에 모여요")).toBeInTheDocument();
  });
});
