import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { MarkItem, SectionItem } from "@truewords/api-client-ts/types";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
  usePathname: () => "/hoondok/records",
  useSearchParams: () => searchParams,
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
vi.mock("@/features/hoondok/library/api", async (original) => ({
  ...(await original<object>()),
  libraryAPI: { marks: vi.fn(), sections: vi.fn() },
}));
vi.mock("@/features/hoondok/missions-api", () => ({ missionsAPI: { complete: vi.fn(), summary: vi.fn() } }));
vi.mock("@/features/hoondok/history-api", () => ({ historyAPI: { month: vi.fn() } }));
vi.mock("@/features/hoondok/jeongseong-api", () => ({
  jeongseongAPI: { current: vi.fn(), create: vi.fn(), abandon: vi.fn() },
}));

import { appendAskItem } from "@/features/hoondok/ask/storage";
import { GardenScreen } from "@/features/hoondok/garden/components/garden-screen";
import { historyAPI } from "@/features/hoondok/history-api";
import { jeongseongAPI } from "@/features/hoondok/jeongseong-api";
import { libraryAPI, wordsHref } from "@/features/hoondok/library/api";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { readAllNotes, writeNote } from "@/features/hoondok/note/storage";
import { DeviceRecordsScreen, notesAsText } from "@/features/hoondok/records/components/device-records";
import { RecordsScreen } from "@/features/hoondok/records/components/records-screen";
import {
  applyFilter,
  countRecords,
  formatCount,
  parseRecordsFilter,
  recordsHref,
  sectionGroups,
  volumeGroups,
  volumeTitle,
} from "@/features/hoondok/records/records";
import { screenFor } from "@/features/hoondok/screens";
import { identityAPI } from "@/features/identity/api";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const VOLUME = "천성경.docx";

function mark(overrides: Partial<MarkItem> & Pick<MarkItem, "chunk_id" | "chunk_index">): MarkItem {
  return {
    volume: VOLUME,
    kind: "highlight",
    color: 1,
    note: null,
    updated_at: "2026-09-28T01:00:00Z",
    work_title: "천성경",
    label: "천성경",
    excerpt: `단락 ${overrides.chunk_index + 1} 원문 발췌`,
    ...overrides,
  };
}

// 최신순(서버 순서): 분홍 노트 → 노랑 → 북마크 → 초록(평화경)
const MARKS: MarkItem[] = [
  mark({ chunk_id: "c12", chunk_index: 11, color: 3, note: "아이와 함께 읽음", updated_at: "2026-09-28T01:00:00Z" }),
  mark({ chunk_id: "c11", chunk_index: 10, color: 1, updated_at: "2026-09-27T01:00:00Z" }),
  mark({ chunk_id: "c3", chunk_index: 2, kind: "bookmark", color: null, updated_at: "2026-09-26T01:00:00Z" }),
  mark({
    chunk_id: "p1",
    chunk_index: 0,
    color: 2,
    volume: "평화경.docx",
    work_title: "평화경",
    label: "평화경",
    updated_at: "2026-09-25T01:00:00Z",
  }),
];

const SECTIONS: SectionItem[] = [
  {
    position: 1,
    level: 1,
    title: "제1편 참사랑",
    start_chunk_index: 0,
    end_chunk_index: 19,
    spoken_on: null,
    place: null,
  },
  {
    position: 2,
    level: 2,
    title: "1장 참사랑의 근본",
    start_chunk_index: 0,
    end_chunk_index: 9,
    spoken_on: null,
    place: null,
  },
  {
    position: 3,
    level: 2,
    title: "2장 참사랑의 속성",
    start_chunk_index: 10,
    end_chunk_index: 19,
    spoken_on: null,
    place: null,
  },
];

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function loggedIn(items: MarkItem[] = MARKS) {
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
  vi.mocked(libraryAPI.marks).mockResolvedValue({ items });
  vi.mocked(libraryAPI.sections).mockResolvedValue({ volume: VOLUME, sections: SECTIONS });
}

function loggedOut() {
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "x" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  searchParams = new URLSearchParams();
});

describe("나의 기록 순수 함수", () => {
  it("화면 레지스트리: 두 화면 모두 정원 탭이고 뒤로는 정원이다", () => {
    for (const [path, title] of [
      ["/hoondok/records", "나의 기록"],
      ["/hoondok/records/device", "이 기기에만 있는 기록"],
    ]) {
      const screen = screenFor(path);
      expect([screen.title, screen.backHref, screen.tabId]).toEqual([title, "/hoondok/garden", "garden"]);
    }
  });

  it("URL 필터: 모르는 값은 기본값이고 기본값은 URL 에 쓰지 않으며 북마크는 색을 버린다", () => {
    expect(parseRecordsFilter(new URLSearchParams("tab=x&color=9"))).toEqual({
      tab: "highlight",
      color: null,
      volume: null,
    });
    expect(parseRecordsFilter(new URLSearchParams("tab=note&color=3&volume=천성경.docx"))).toEqual({
      tab: "note",
      color: 3,
      volume: VOLUME,
    });
    expect(recordsHref()).toBe("/hoondok/records");
    expect(recordsHref({ tab: "note", color: 3 })).toBe("/hoondok/records?tab=note&color=3");
    expect(recordsHref({ tab: "bookmark", color: 2, volume: VOLUME })).toBe(
      `/hoondok/records?tab=bookmark&volume=${encodeURIComponent(VOLUME).replace(/%20/g, "+")}`,
    );
  });

  it("노트는 형광펜에 포함해 세고, 상한까지 오면 '+' 를 붙인다", () => {
    expect(countRecords(MARKS)).toEqual({ highlight: 3, note: 1, bookmark: 1 });
    expect(formatCount(23, false)).toBe("23");
    expect(formatCount(200, true)).toBe("200+");
    expect(formatCount(0, true)).toBe("0");
    // 공백만 있는 노트는 노트가 아니다
    expect(countRecords([mark({ chunk_id: "x", chunk_index: 1, note: "  " })]).note).toBe(0);
  });

  it("색·권으로 거르고 권은 최근에 남긴 순서로 묶는다", () => {
    expect(applyFilter(MARKS, { tab: "highlight", color: 3, volume: null }).map((m) => m.chunk_id)).toEqual(["c12"]);
    expect(applyFilter(MARKS, { tab: "highlight", color: null, volume: "평화경.docx" }).map((m) => m.chunk_id)).toEqual(
      ["p1"],
    );
    // 북마크 탭은 색을 보지 않는다
    expect(applyFilter(MARKS, { tab: "bookmark", color: 3, volume: null }).map((m) => m.chunk_id)).toEqual(["c3"]);
    expect(volumeGroups(MARKS)).toEqual([
      { volume: VOLUME, title: "천성경", count: 3 },
      { volume: "평화경.docx", title: "평화경", count: 1 },
    ]);
    expect(volumeTitle({ work_title: "문선명선생 말씀선집", label: "355권" })).toBe("문선명선생 말씀선집 355권");
    expect(volumeTitle({ work_title: "말씀선집 355권", label: "355권" })).toBe("말씀선집 355권");
  });

  it("한 권은 원문 순서로 놓고 더 좁은 장 머리 아래에 묶는다", () => {
    const groups = sectionGroups(
      [
        mark({ chunk_id: "a", chunk_index: 12 }),
        mark({ chunk_id: "b", chunk_index: 3 }),
        mark({ chunk_id: "c", chunk_index: 25 }),
        mark({ chunk_id: "d", chunk_index: 10 }),
      ],
      SECTIONS,
    );
    expect(groups.map((g) => [g.section?.title ?? null, g.items.map((m) => m.chunk_index)])).toEqual([
      ["1장 참사랑의 근본", [3]],
      ["2장 참사랑의 속성", [10, 12]],
      [null, [25]],
    ]);
    // 목차가 없으면 머리 없는 한 묶음
    expect(sectionGroups([mark({ chunk_id: "a", chunk_index: 5 })], [])).toHaveLength(1);
  });
});

describe("정원 '나의 기록' 섹션", () => {
  function renderGarden() {
    vi.mocked(missionsAPI.summary).mockResolvedValue({
      today: { read: false, pray: false, study: false },
      streak_days: 0,
      best_streak_days: 0,
      total_days: 0,
      week: [],
    });
    vi.mocked(historyAPI.month).mockResolvedValue({ month: "2026-09", days: [] });
    vi.mocked(jeongseongAPI.current).mockResolvedValue({ period: null });
    return render(wrap(<GardenScreen month="2026-09" today="2026-09-29" />));
  }

  it("이름 먼저 세 가지 수가 각 탭의 입구이고, 최근 형광펜 발췌가 원문 그 단락으로 간다", async () => {
    loggedIn();
    renderGarden();
    const nav = await screen.findByRole("navigation", { name: "나의 기록 종류" });
    expect(within(nav).getByRole("link", { name: "형광펜 3" })).toHaveAttribute("href", "/hoondok/records");
    expect(within(nav).getByRole("link", { name: "북마크 1" })).toHaveAttribute(
      "href",
      "/hoondok/records?tab=bookmark",
    );
    expect(within(nav).getByRole("link", { name: "노트 1" })).toHaveAttribute("href", "/hoondok/records?tab=note");
    expect(libraryAPI.marks).toHaveBeenCalledWith({ excerpt: true });
    const latest = screen.getByRole("link", { name: /최근 형광펜/ });
    expect(latest).toHaveAttribute("href", wordsHref(VOLUME, "c12"));
    expect(latest).toHaveTextContent("단락 12 원문 발췌");
    expect(latest.querySelector("mark.hl-3")).not.toBeNull();
    expect(screen.getByRole("link", { name: "모두 보기" })).toHaveAttribute("href", "/hoondok/records");
  });

  it("원문이 막힌 최근 형광펜은 발췌 대신 안내만 두고 링크를 숨긴다", async () => {
    loggedIn([mark({ chunk_id: "c1", chunk_index: 0, excerpt: null })]);
    renderGarden();
    expect(await screen.findByText("원문 공개 확인 중")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /최근 형광펜/ })).toBeNull();
  });

  it("200개(상한)면 수 뒤에 '+' 를 붙인다", async () => {
    loggedIn(Array.from({ length: 200 }, (_, index) => mark({ chunk_id: `c${index}`, chunk_index: index })));
    renderGarden();
    expect(await screen.findByRole("link", { name: "형광펜 200+" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "북마크 0" })).toBeInTheDocument();
  });

  it("기록이 없으면 문구와 서고 입구만, 불러오지 못하면 다시 시도", async () => {
    loggedIn([]);
    renderGarden();
    expect(await screen.findByRole("heading", { name: "아직 남긴 기록이 없어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "말씀 서고로 가기" })).toHaveAttribute("href", "/hoondok/library");
    expect(screen.queryByRole("navigation", { name: "나의 기록 종류" })).toBeNull();
  });

  it("표시 목록이 실패해도 정원의 나머지는 보이고 다시 시도하면 다시 부른다", async () => {
    loggedIn();
    vi.mocked(libraryAPI.marks).mockRejectedValue(new Error("down"));
    renderGarden();
    expect(await screen.findByRole("heading", { name: "기록을 불러오지 못했어요" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "진행 중인 정성" })).toBeInTheDocument();
    vi.mocked(libraryAPI.marks).mockResolvedValue({ items: MARKS });
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("link", { name: "형광펜 3" })).toBeInTheDocument();
  });

  it("비로그인은 표시 목록을 부르지 않는다", async () => {
    loggedOut();
    renderGarden();
    expect(await screen.findByRole("link", { name: "시작하기" })).toBeInTheDocument();
    expect(libraryAPI.marks).not.toHaveBeenCalled();
  });
});

describe("나의 기록 화면", () => {
  function renderRecords() {
    return render(wrap(<RecordsScreen />));
  }

  it("기본은 형광펜 탭 최신순이고 탭·색 칩은 URL 을 바꾼다", async () => {
    loggedIn();
    renderRecords();
    const tabs = await screen.findByRole("tablist", { name: "기록 종류" });
    expect(within(tabs).getByRole("tab", { name: "형광펜 3" })).toHaveAttribute("aria-selected", "true");
    const list = screen.getByRole("tabpanel");
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      wordsHref(VOLUME, "c12"),
      wordsHref(VOLUME, "c11"),
      wordsHref("평화경.docx", "p1"),
    ]);
    expect(links[0]).toHaveTextContent("아이와 함께 읽음");
    expect(links[0]).toHaveTextContent("분홍");

    fireEvent.click(within(tabs).getByRole("tab", { name: "노트 1" }));
    expect(replace).toHaveBeenLastCalledWith("/hoondok/records?tab=note", { scroll: false });
    const colors = screen.getByRole("group", { name: "형광펜 색" });
    expect(within(colors).getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(colors).getByRole("button", { name: "분홍 1" }));
    expect(replace).toHaveBeenLastCalledWith("/hoondok/records?color=3", { scroll: false });
  });

  it("URL 의 탭·색을 그대로 보인다 — 뒤로 돌아오면 같은 칩이 골라져 있다", async () => {
    searchParams = new URLSearchParams("color=3");
    loggedIn();
    renderRecords();
    const colors = await screen.findByRole("group", { name: "형광펜 색" });
    expect(within(colors).getByRole("button", { name: "분홍 1" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("tabpanel")).getAllByRole("link")).toHaveLength(1);
  });

  it("북마크 탭에는 색 칩이 없다", async () => {
    searchParams = new URLSearchParams("tab=bookmark");
    loggedIn();
    renderRecords();
    await screen.findByRole("tab", { name: "북마크 1" });
    expect(screen.queryByRole("group", { name: "형광펜 색" })).toBeNull();
    expect(within(screen.getByRole("tabpanel")).getAllByRole("link")).toHaveLength(1);
  });

  it("권을 고르면 목차 장 머리 아래 원문 순서로 놓는다", async () => {
    searchParams = new URLSearchParams(`volume=${encodeURIComponent(VOLUME)}`);
    loggedIn([
      mark({ chunk_id: "c12", chunk_index: 11 }),
      mark({ chunk_id: "c2", chunk_index: 1 }),
      mark({ chunk_id: "c11", chunk_index: 10 }),
    ]);
    renderRecords();
    const volumes = await screen.findByRole("group", { name: "권" });
    expect(within(volumes).getByRole("button", { name: "천성경 3" })).toHaveAttribute("aria-pressed", "true");
    await screen.findByRole("heading", { name: "2장 참사랑의 속성" });
    expect(libraryAPI.sections).toHaveBeenCalledWith(VOLUME, expect.anything());
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["1장 참사랑의 근본", "2장 참사랑의 속성"]);
    const hrefs = within(screen.getByRole("tabpanel"))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([wordsHref(VOLUME, "c2"), wordsHref(VOLUME, "c11"), wordsHref(VOLUME, "c12")]);

    fireEvent.click(within(volumes).getByRole("button", { name: "모든 권" }));
    expect(replace).toHaveBeenLastCalledWith("/hoondok/records", { scroll: false });
  });

  it("원문이 막힌 단락은 '원문 공개 확인 중' 이고 링크가 없다", async () => {
    loggedIn([mark({ chunk_id: "c1", chunk_index: 0, excerpt: null, note: "내 노트" })]);
    renderRecords();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText("원문 공개 확인 중")).toBeInTheDocument();
    expect(within(panel).getByText("내 노트")).toBeInTheDocument();
    expect(within(panel).queryAllByRole("link")).toHaveLength(0);
  });

  it("빈 기록 · 빈 탭 · 오류 · 비로그인", async () => {
    loggedIn([]);
    const { unmount } = renderRecords();
    expect(await screen.findByRole("heading", { name: "아직 남긴 기록이 없어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "말씀 서고로 가기" })).toHaveAttribute("href", "/hoondok/library");
    unmount();

    searchParams = new URLSearchParams("tab=note");
    loggedIn([mark({ chunk_id: "c1", chunk_index: 0 })]);
    const second = renderRecords();
    expect(await screen.findByRole("heading", { name: "아직 남긴 노트가 없어요" })).toBeInTheDocument();
    second.unmount();

    loggedIn();
    vi.mocked(libraryAPI.marks).mockRejectedValue(new Error("down"));
    const third = renderRecords();
    expect(await screen.findByRole("heading", { name: "기록을 불러오지 못했어요" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    third.unmount();

    loggedOut();
    renderRecords();
    expect(await screen.findByRole("link", { name: "시작하기" })).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent("/hoondok/records")),
    );
  });
});

describe("이 기기에만 있는 기록", () => {
  it("한 줄은 날짜 최신순이고 날짜가 아닌 키·빈 값은 건너뛴다", () => {
    writeNote("2026-09-21", "새벽에 기도하기");
    writeNote("2026-09-28", "아이에게 먼저 인사하기");
    writeNote("2026-09-24", "끝까지 듣기");
    localStorage.setItem("hoondok:note:not-a-date", "x");
    localStorage.setItem("hoondok:note:2026-09-25", "   ");
    expect(readAllNotes().map((note) => note.date)).toEqual(["2026-09-28", "2026-09-24", "2026-09-21"]);
    // 저장값이 그대로면 같은 참조 — useSyncExternalStore 무한 렌더 방지
    expect(readAllNotes()).toBe(readAllNotes());
    expect(notesAsText(readAllNotes().slice(0, 2))).toBe(
      "2026년 9월 28일\n아이에게 먼저 인사하기\n\n2026년 9월 24일\n끝까지 듣기",
    );
  });

  it("한 줄 전부를 날짜와 함께 복사하고 저장한 AI 답은 수와 링크만 보인다 — 서버 요청 0", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    writeNote("2026-09-26", "안부 전화 드리기");
    writeNote("2026-09-28", "먼저 인사하기");
    appendAskItem({ id: "a1", question: "q1", status: "answered", createdAt: "2026-09-28T00:00:00Z", isSaved: true });
    appendAskItem({ id: "a2", question: "q2", status: "answered", createdAt: "2026-09-28T00:00:00Z" });

    render(<DeviceRecordsScreen />);
    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.querySelector("time")?.getAttribute("datetime"))).toEqual([
      "2026-09-28",
      "2026-09-26",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "한 줄 모두 글로 복사" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("2026년 9월 28일\n먼저 인사하기\n\n2026년 9월 26일\n안부 전화 드리기"),
    );
    expect(await screen.findByText("복사했어요")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "저장한 AI 답" }).parentElement).toHaveTextContent("1개");
    expect(screen.getByRole("link", { name: /AI 질문 기록에서 보기/ })).toHaveAttribute("href", "/hoondok/ask/log");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("정원 입구는 기기 기록이 있을 때만 — 비로그인 정원에도 보인다", async () => {
    loggedOut();
    const { unmount } = render(wrap(<GardenScreen month="2026-09" today="2026-09-29" />));
    await screen.findByRole("link", { name: "시작하기" });
    expect(screen.queryByRole("link", { name: /오늘의 한 줄/ })).toBeNull();
    unmount();

    writeNote("2026-09-28", "먼저 인사하기");
    render(wrap(<GardenScreen month="2026-09" today="2026-09-29" />));
    await screen.findByRole("link", { name: "시작하기" });
    expect(screen.getByRole("link", { name: /오늘의 한 줄 1개/ })).toHaveAttribute("href", "/hoondok/records/device");
    expect(libraryAPI.marks).not.toHaveBeenCalled();
  });
});
