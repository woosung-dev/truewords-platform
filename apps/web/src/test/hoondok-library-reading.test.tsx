// PLAN-HD-007 말씀 서고 3계층·읽기 기록. 기존 hoondok-library.test.tsx 가 검증한 평면 목록·검색은 그대로 두고
// 여기서는 저작물 → 권 → 장, 단락 표시, AI 설명, 이어 읽기 병합과 구절 형광펜·메모(API-HD-053)를 본다.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { HighlightInput, HighlightItem } from "@truewords/api-client-ts/types";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/hoondok/library";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/features/hoondok/library/api", async (original) => ({
  ...(await original<object>()),
  libraryAPI: {
    list: vi.fn(),
    search: vi.fn(),
    words: vi.fn(),
    series: vi.fn(),
    sections: vi.fn(),
    readingPositions: vi.fn(),
    saveReadingPosition: vi.fn(),
    marks: vi.fn(),
    saveMark: vi.fn(),
    deleteMark: vi.fn(),
    highlights: vi.fn(),
    createHighlight: vi.fn(),
    updateHighlight: vi.fn(),
    deleteHighlight: vi.fn(),
  },
}));
vi.mock("@/features/identity/api", () => ({ identityAPI: { me: vi.fn() } }));
vi.mock("@/features/hoondok/missions-api", () => ({ missionsAPI: { summary: vi.fn(), complete: vi.fn() } }));
vi.mock("@/features/hoondok/ask/ask-stream", async (original) => ({
  ...(await original<object>()),
  requestAsk: vi.fn(),
}));

import SeriesPage from "@/app/(hoondok)/hoondok/library/[series]/page";
import LibraryPage from "@/app/(hoondok)/hoondok/library/page";
import WordsPage from "@/app/(hoondok)/hoondok/words/[id]/page";
import { requestAsk } from "@/features/hoondok/ask/ask-stream";
import { libraryAPI, seriesHref, wordsHref } from "@/features/hoondok/library/api";
import { EXPLAIN_PREFIX } from "@/features/hoondok/library/components/ai-explain";
import { writeLastReading } from "@/features/hoondok/library/last-reading";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { identityAPI } from "@/features/identity/api";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const VOLUME = "말씀선집   001권.pdf";
const SERIES = "father_anthology";
const ITEM = {
  volume: VOLUME,
  work_title: "말씀선집 001권",
  scope_search: true,
  scope_full_text: true,
  source_keys: ["A"],
  book_series: SERIES,
  authority_grade: "O1" as const,
};
const OTHER = { ...ITEM, volume: "말씀선집   002권.pdf", work_title: "말씀선집 002권" };
const WORK = {
  series: SERIES,
  title: "문선명선생 말씀선집",
  volume_count: 615,
  allowed_count: 2,
  authority_grade: "O1" as const,
  scope_search: true,
  scope_full_text: true,
};
const SECTIONS = [
  {
    position: 1,
    level: 1,
    title: "제1편 감사의 길",
    start_chunk_index: 0,
    end_chunk_index: 19,
    spoken_on: null,
    place: null,
  },
  {
    position: 2,
    level: 2,
    title: "1장 이웃을 듣는 마음",
    start_chunk_index: 0,
    end_chunk_index: 19,
    spoken_on: "1956년 4월 8일",
    place: "전 본부교회",
  },
];
const WORDS = {
  volume: VOLUME,
  work_title: "말씀선집 001권",
  scope_search: true,
  scope_full_text: true,
  source_keys: ["A"],
  book_series: SERIES,
  authority_grade: "O1" as const,
  page: 1,
  page_size: 20,
  total_chunks: 25,
  total_pages: 2,
  section: { position: 2, level: 2, title: "1장 이웃을 듣는 마음" },
  chunks: [
    { chunk_id: "c0", chunk_index: 0, text: "첫째 단락의 본문", display_text: "첫째 단락의 본문" },
    { chunk_id: "c1", chunk_index: 1, text: "둘째 단락의 본문", display_text: "둘째 단락의 본문" },
  ],
  body: "첫째 단락의 본문",
};

/** 형광펜 서버 흉내 — 쓰기가 끝난 뒤 다시 읽어도 같은 값을 돌려주게 메모리에 둔다. */
let serverHighlights: HighlightItem[] = [];
let clock = 0;
function tick(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 8, 29, 0, 0, clock)).toISOString();
}
function highlight(overrides: Partial<HighlightItem> = {}): HighlightItem {
  const at = tick();
  return {
    id: "h1",
    volume: VOLUME,
    chunk_id: "c0",
    start_chunk_index: 0,
    start_offset: 3,
    end_chunk_index: 0,
    end_offset: 6,
    quote: "단락의",
    color: 2,
    note: null,
    created_at: at,
    updated_at: at,
    work_title: ITEM.work_title,
    label: "001권",
    ...overrides,
  };
}

function show(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}
function loggedIn() {
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
}
async function showWords(searchParams: Record<string, string> = {}) {
  return show(
    await WordsPage({
      params: Promise.resolve({ id: encodeURIComponent(VOLUME) }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  pathname = "/hoondok/library";
  vi.clearAllMocks();
  localStorage.clear();
  window.getSelection()?.removeAllRanges();
  serverHighlights = [];
  let created = 0;
  vi.mocked(libraryAPI.highlights).mockImplementation(async () => ({ items: [...serverHighlights] }));
  vi.mocked(libraryAPI.createHighlight).mockImplementation(async (input: HighlightInput) => {
    created += 1;
    const item = highlight({ ...input, id: `new-${created}`, note: input.note ?? null });
    serverHighlights = [item, ...serverHighlights];
    return item;
  });
  vi.mocked(libraryAPI.updateHighlight).mockImplementation(async (id, patch) => {
    const current = serverHighlights.find((item) => item.id === id);
    if (!current) throw new ApiError(404, { message: "not found" });
    const next = {
      ...current,
      color: patch.color ?? current.color,
      note: patch.note === undefined ? current.note : patch.note || null,
      updated_at: tick(),
    };
    serverHighlights = serverHighlights.map((item) => (item.id === id ? next : item));
    return next;
  });
  vi.mocked(libraryAPI.deleteHighlight).mockImplementation(async (id) => {
    serverHighlights = serverHighlights.filter((item) => item.id !== id);
  });
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", "");
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "unauthorized" }));
  vi.mocked(libraryAPI.list).mockResolvedValue({ items: [ITEM, OTHER], works: [WORK] });
  vi.mocked(libraryAPI.words).mockResolvedValue(WORDS);
  vi.mocked(libraryAPI.sections).mockResolvedValue({ volume: VOLUME, sections: SECTIONS });
  vi.mocked(libraryAPI.marks).mockResolvedValue({ items: [] });
  vi.mocked(libraryAPI.readingPositions).mockResolvedValue({ items: [] });
  vi.mocked(libraryAPI.saveMark).mockResolvedValue({
    chunk_id: "c0",
    chunk_index: 0,
    volume: VOLUME,
    kind: "bookmark",
    color: null,
    note: null,
    updated_at: "2026-09-23T00:00:00Z",
    work_title: ITEM.work_title,
    label: "001권",
  });
  vi.mocked(libraryAPI.deleteMark).mockResolvedValue(undefined);
  vi.mocked(libraryAPI.saveReadingPosition).mockResolvedValue({
    volume: VOLUME,
    chunk_index: 0,
    updated_at: "2026-09-23T00:00:00Z",
    work_title: ITEM.work_title,
    series: SERIES,
    label: "001권",
  });
  vi.mocked(missionsAPI.summary).mockResolvedValue({
    streak_days: 0,
    today: { read: false, pray: false, study: false },
  } as never);
});

describe("서고 저작물 계층", () => {
  it("저작물 카드는 권 수·등급과 함께 권 목록으로 간다", async () => {
    show(LibraryPage());
    const card = await screen.findByRole("link", { name: /문선명선생 말씀선집/ });
    expect(card).toHaveAttribute("href", seriesHref(SERIES));
    expect(within(card).getByText("2/615권 공개")).toBeInTheDocument();
  });
  it("허용된 권이 하나뿐이면 권 목록을 건너뛰고 원문으로 간다", async () => {
    vi.mocked(libraryAPI.list).mockResolvedValue({
      items: [ITEM],
      works: [{ ...WORK, volume_count: 1, allowed_count: 1 }],
    });
    show(LibraryPage());
    const card = await screen.findByRole("link", { name: /문선명선생 말씀선집/ });
    expect(card).toHaveAttribute("href", wordsHref(VOLUME));
    expect(within(card).getByText("1권")).toBeInTheDocument();
  });
  it("저작물로 묶이지 않은 원장은 지금까지처럼 권 목록을 보인다", async () => {
    vi.mocked(libraryAPI.list).mockResolvedValue({ items: [{ ...ITEM, book_series: null }], works: [] });
    show(LibraryPage());
    expect(await screen.findByRole("link", { name: /말씀선집 001권/ })).toHaveAttribute("href", wordsHref(VOLUME));
  });
});

describe("권 목록 화면", () => {
  it("권마다 단락 수·장 수를 보이고 원문으로 간다", async () => {
    vi.mocked(libraryAPI.series).mockResolvedValue({
      series: SERIES,
      title: "문선명선생 말씀선집",
      authority_grade: "O1",
      volumes: [
        { volume: VOLUME, label: "001권", total_chunks: 25, section_count: 2, scope_full_text: true },
        { volume: OTHER.volume, label: "002권", total_chunks: null, section_count: 0, scope_full_text: true },
      ],
    });
    show(await SeriesPage({ params: Promise.resolve({ series: SERIES }) }));
    const first = await screen.findByRole("link", { name: /001권/ });
    expect(first).toHaveAttribute("href", wordsHref(VOLUME));
    expect(within(first).getByText("단락 25개 · 장 2개")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /002권/ })).toHaveAttribute("href", wordsHref(OTHER.volume));
  });
  it("원문이 허용되지 않은 권은 링크가 아니라 검색 안내를 보인다", async () => {
    vi.mocked(libraryAPI.series).mockResolvedValue({
      series: SERIES,
      title: "문선명선생 말씀선집",
      authority_grade: "O1",
      volumes: [
        { volume: VOLUME, label: "001권", total_chunks: 25, section_count: 2, scope_full_text: true },
        { volume: OTHER.volume, label: "002권", total_chunks: 30, section_count: 0, scope_full_text: false },
      ],
    });
    show(await SeriesPage({ params: Promise.resolve({ series: SERIES }) }));
    await screen.findByRole("link", { name: /001권/ });
    expect(screen.queryByRole("link", { name: /002권/ })).toBeNull();
    expect(screen.getByText("검색 인용만 허용 · 원문 공개 확인 중")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "말씀 검색하기" })).toHaveAttribute("href", "/hoondok/search");
  });
  it("공개되지 않은 저작물은 404 를 그대로 알리고 서고로 돌려보낸다", async () => {
    vi.mocked(libraryAPI.series).mockRejectedValue(new ApiError(404, { message: "not found" }));
    show(await SeriesPage({ params: Promise.resolve({ series: "없는시리즈" }) }));
    expect(await screen.findByText("이 저작물은 아직 공개되지 않았어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "서고로 돌아가기" })).toHaveAttribute("href", "/hoondok/library");
  });
});

describe("검색으로 들어온 원문", () => {
  it("도착 단락의 검색어에 임시 밑줄을 긋고, 검색어는 원문 API 로 보내지 않는다", async () => {
    await showWords({ chunk_id: "c1", q: "단락의" });
    const hit = await screen.findByText("단락의", { selector: "mark.sq-hit" });
    expect(hit.closest("p")).toHaveClass("verse--arrive");
    // 다른 단락에는 긋지 않는다
    expect(document.querySelectorAll("mark.sq-hit")).toHaveLength(1);
    expect(libraryAPI.words).toHaveBeenCalledWith(
      VOLUME,
      1,
      { chunkId: "c1", section: undefined },
      expect.any(AbortSignal),
    );
    expect(screen.getByText(/검색어에 밑줄을 그었어요/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "밑줄 지우기" }));
    expect(document.querySelectorAll("mark.sq-hit")).toHaveLength(0);
    expect(screen.getByText("인용한 말씀이 포함된 원문 구간이에요.")).toBeInTheDocument();
  });
  it("검색어가 본문에 없으면 뜻이 가까운 구간이라고 알린다", async () => {
    await showWords({ chunk_id: "c1", q: "탕감복귀" });
    expect(await screen.findByText("검색어가 그대로 나오지는 않지만 뜻이 가까운 구간이에요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "밑줄 지우기" })).not.toBeInTheDocument();
  });
  it("검색 결과 링크는 검색어를 q 로 싣는다", () => {
    expect(wordsHref(VOLUME, "c1", "참 사랑")).toBe(
      `${wordsHref(VOLUME)}?chunk_id=c1&q=%EC%B0%B8%20%EC%82%AC%EB%9E%91`,
    );
  });
});

describe("원문 목차·단락", () => {
  it("장 목차를 편·장 단계로 보이고 현재 장을 표시한다", async () => {
    await showWords();
    const toc = await screen.findByRole("complementary", { name: "목차" });
    expect(within(toc).getByRole("link", { name: "제1편 감사의 길" })).toHaveAttribute(
      "href",
      `${wordsHref(VOLUME)}?section=1`,
    );
    expect(within(toc).getByRole("link", { name: "1장 이웃을 듣는 마음" })).toHaveAttribute("aria-current", "page");
  });
  it("장이 0건인 권은 원문 구간 목록으로 폴백한다", async () => {
    vi.mocked(libraryAPI.sections).mockResolvedValue({ volume: VOLUME, sections: [] });
    vi.mocked(libraryAPI.words).mockResolvedValue({ ...WORDS, section: null });
    await showWords();
    const toc = await screen.findByRole("complementary", { name: "원문 구간" });
    expect(within(toc).getByRole("link", { name: "원문 구간 2" })).toHaveAttribute(
      "href",
      `${wordsHref(VOLUME)}?page=2`,
    );
  });
  it("section 쿼리는 원문 요청으로 전달된다", async () => {
    await showWords({ section: "2" });
    await screen.findByText("첫째 단락의 본문");
    expect(libraryAPI.words).toHaveBeenCalledWith(
      VOLUME,
      1,
      { chunkId: undefined, section: 2 },
      expect.any(AbortSignal),
    );
  });
  it("section 으로 들어오면 고른 장이 머리말·목차에 그대로 뜬다", async () => {
    // 서버가 요청한 장을 그대로 돌려준다(API-HD-016) — 페이지 첫 청크가 속한 앞 장이 아니다
    vi.mocked(libraryAPI.words).mockResolvedValue({
      ...WORDS,
      section: { position: 1, level: 1, title: "제1편 감사의 길" },
    });
    await showWords({ section: "1" });
    expect(await screen.findByText("제1편 감사의 길", { selector: ".masthead__nm" })).toBeInTheDocument();
    const toc = screen.getByRole("complementary", { name: "목차" });
    expect(within(toc).getByRole("link", { name: "제1편 감사의 길" })).toHaveAttribute("aria-current", "page");
  });
  it("chunk_id 로 들어오면 인용된 단락까지 내려 준다", async () => {
    // 검색 결과·북마크 링크(API-HD-016 chunk_id). 페이지 첫 단락이 아니라 가리킨 단락이 목표다
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    await showWords({ chunk_id: "c1" });
    await screen.findByText("둘째 단락의 본문");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("verse-1"));
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });
  it("단락 번호(1부터)와 장 제목·구간 번호를 보인다", async () => {
    await showWords();
    expect(await screen.findByText("1장 이웃을 듣는 마음", { selector: ".masthead__nm" })).toBeInTheDocument();
    expect(screen.getByText("1 / 2 구간")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "단락 2 표시하기" })).toBeInTheDocument();
    // 장이 날짜·장소를 가지면 실제 값을 쓴다
    expect(screen.getByText("1956년 4월 8일")).toBeInTheDocument();
    expect(screen.getByText("전 본부교회")).toBeInTheDocument();
    expect(screen.queryByText("날짜 확인되지 않음")).toBeNull();
  });
  it("불러오는 동안 머리글·단락 자리를 보이고 문구는 상태 영역에 남긴다", async () => {
    vi.mocked(libraryAPI.words).mockReturnValue(new Promise(() => {}));
    const view = await showWords();
    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("원문을 불러오고 있어요");
    expect(view.container.querySelectorAll(".wd-skel--verse")).toHaveLength(4);
    expect(view.container.querySelector(".wd-skel--head")).not.toBeNull();
  });
  it("머리글에 파일 이름·결측 문구를 보이지 않는다", async () => {
    vi.mocked(libraryAPI.sections).mockResolvedValue({ volume: VOLUME, sections: [] });
    vi.mocked(libraryAPI.words).mockResolvedValue({ ...WORDS, section: null });
    const view = await showWords();
    await screen.findByText("첫째 단락의 본문");
    const source = view.container.querySelector(".lede-src");
    expect(source).not.toBeNull();
    expect(source).not.toHaveTextContent(VOLUME);
    expect(source).not.toHaveTextContent("확인되지 않음");
    // 권위 배지는 그대로 남는다
    expect(source?.children.length).toBe(1);
  });
  it("구절 형광펜은 고른 글자만 칠하고 북마크는 번호에 표시한다", async () => {
    loggedIn();
    serverHighlights = [highlight({ note: "기억할 문장" })];
    vi.mocked(libraryAPI.marks).mockResolvedValue({
      items: [
        {
          chunk_id: "c1",
          chunk_index: 1,
          volume: VOLUME,
          kind: "bookmark",
          color: null,
          note: null,
          updated_at: "2026-09-23T00:00:00Z",
          work_title: ITEM.work_title,
          label: "001권",
        },
      ],
    });
    const view = await showWords();
    await waitFor(() => expect(view.container.querySelector("mark.hl-2")).toHaveTextContent(/^단락의$/));
    expect(view.container.querySelectorAll("mark")).toHaveLength(1);
    expect(view.container.querySelector("#verse-0 .verse__para")).toHaveTextContent("첫째 단락의 본문");
    // 메모가 있는 형광펜 끝에 메모 표지 — 글자가 아니라 선택에서 빠진다
    expect(screen.getByRole("button", { name: "메모 보기" })).toHaveAttribute("data-hl-ui");
    expect(screen.getByRole("button", { name: "단락 2 표시하기" }).querySelector("svg")).not.toBeNull();
    // 단락 표시 API 는 북마크만 묻는다
    expect(libraryAPI.highlights).toHaveBeenCalledWith({ volume: VOLUME });
  });
});

/** 번호 버튼으로 단락 시트를 연다. 리더 바에도 같은 이름의 버튼이 있어 조회는 시트 안으로 좁힌다. */
async function openSheet(verseNo: number) {
  fireEvent.click(await screen.findByRole("button", { name: `단락 ${verseNo} 표시하기` }));
  return within(await screen.findByRole("dialog"));
}

describe("단락 시트", () => {
  it("단락 전체 칠하기: 색을 고르면 단락 전체를 만들고, 다른 색은 바꾸고, 지금 색은 지운 뒤 되돌릴 수 있다", async () => {
    loggedIn();
    await showWords();
    const sheet = await openSheet(1);
    fireEvent.click(sheet.getByRole("button", { name: "초록 형광펜" }));
    await waitFor(() =>
      expect(libraryAPI.createHighlight).toHaveBeenCalledWith({
        volume: VOLUME,
        chunk_id: "c0",
        start_chunk_index: 0,
        start_offset: 0,
        end_chunk_index: 0,
        end_offset: 9,
        quote: "첫째 단락의 본문",
        color: 2,
      }),
    );
    await waitFor(() =>
      expect(sheet.getByRole("button", { name: "초록 형광펜" })).toHaveAttribute("aria-pressed", "true"),
    );
    await waitFor(() => expect(document.querySelector("#verse-0 mark.hl-2")).toHaveTextContent("첫째 단락의 본문"));

    fireEvent.click(sheet.getByRole("button", { name: "분홍 형광펜" }));
    await waitFor(() => expect(libraryAPI.updateHighlight).toHaveBeenCalledWith("new-1", { color: 3 }));
    await waitFor(() =>
      expect(sheet.getByRole("button", { name: "분홍 형광펜" })).toHaveAttribute("aria-pressed", "true"),
    );

    // 지금 색을 다시 누르면 지운다 — 조용히 지우지 않고 시트 안 알림으로 되돌릴 기회를 준다
    fireEvent.click(sheet.getByRole("button", { name: "분홍 형광펜" }));
    await waitFor(() => expect(libraryAPI.deleteHighlight).toHaveBeenCalledWith("new-1"));
    expect(await sheet.findByText("형광펜을 지웠어요")).toBeInTheDocument();
    fireEvent.click(sheet.getByRole("button", { name: "되돌리기" }));
    await waitFor(() => expect(libraryAPI.createHighlight).toHaveBeenCalledTimes(2));
    expect(vi.mocked(libraryAPI.createHighlight).mock.calls[1][0]).toMatchObject({ color: 3, end_offset: 9 });
  });
  it("부분 구절 형광펜은 단락 전체 칠하기에 눌린 색으로 보이지 않는다", async () => {
    loggedIn();
    serverHighlights = [highlight()];
    await showWords();
    await waitFor(() => expect(document.querySelector("mark.hl-2")).not.toBeNull());
    const sheet = await openSheet(1);
    for (const name of ["노랑 형광펜", "초록 형광펜", "분홍 형광펜"])
      expect(sheet.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
  });
  it("북마크는 bookmark 표시로 토글되고 시트에는 노트 입력이 없다", async () => {
    loggedIn();
    await showWords();
    const sheet = await openSheet(1);
    fireEvent.click(sheet.getByRole("button", { name: "북마크" }));
    await waitFor(() =>
      expect(libraryAPI.saveMark).toHaveBeenCalledWith("c0", {
        volume: VOLUME,
        chunk_index: 0,
        kind: "bookmark",
        color: null,
        note: null,
      }),
    );
    expect(sheet.queryByRole("textbox")).toBeNull();
    expect(sheet.getByText(/원하는 구절만 칠하려면 본문 글자를 길게 누르세요/)).toBeInTheDocument();
  });
  it("북마크된 단락은 해제로 지운다", async () => {
    loggedIn();
    vi.mocked(libraryAPI.marks).mockResolvedValue({
      items: [
        {
          chunk_id: "c0",
          chunk_index: 0,
          volume: VOLUME,
          kind: "bookmark",
          color: null,
          note: null,
          updated_at: "2026-09-23T00:00:00Z",
          work_title: ITEM.work_title,
          label: "001권",
        },
      ],
    });
    await showWords();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "단락 1 표시하기" }).querySelector("svg")).not.toBeNull(),
    );
    const sheet = await openSheet(1);
    fireEvent.click(sheet.getByRole("button", { name: "북마크 해제" }));
    await waitFor(() => expect(libraryAPI.deleteMark).toHaveBeenCalledWith("c0", "bookmark"));
  });
  it("본문 글자를 눌러도 단락 시트가 열리지 않는다 — 글자 선택과 다투지 않게 번호로만 연다", async () => {
    await showWords();
    fireEvent.click(await screen.findByText("둘째 단락의 본문"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("본문은 서버 표시 텍스트를 문단으로 나눠 그리고 문단을 넘는 형광펜은 문단마다 감싼다", async () => {
    loggedIn();
    vi.mocked(libraryAPI.words).mockResolvedValue({
      ...WORDS,
      chunks: [{ chunk_id: "c0", chunk_index: 0, text: "원본\n줄바꿈", display_text: "첫 문단\n\n둘째 문단" }],
    });
    serverHighlights = [highlight({ start_offset: 2, end_offset: 8, quote: "문단\n\n둘째" })];
    const view = await showWords();
    await waitFor(() => expect(view.container.querySelectorAll("mark.hl-2")).toHaveLength(2));
    expect([...view.container.querySelectorAll("mark.hl-2")].map((node) => node.textContent)).toEqual(["문단", "둘째"]);
    const paragraphs = [...view.container.querySelectorAll(".verse__para")];
    expect(paragraphs.map((node) => node.textContent)).toEqual(["첫 문단", "둘째 문단"]);
    expect(paragraphs.map((node) => node.getAttribute("data-start"))).toEqual(["0", "6"]);
    expect(screen.queryByText(/원본/)).toBeNull();
  });
  it("비로그인은 안내만 보이고 어떤 기록도 보내지 않는다", async () => {
    await showWords();
    const sheet = await openSheet(1);
    expect(sheet.getByText("로그인하면 기록이 남아요")).toBeInTheDocument();
    expect(sheet.queryByRole("button", { name: "노랑 형광펜" })).toBeNull();
    expect(libraryAPI.saveMark).not.toHaveBeenCalled();
    expect(libraryAPI.deleteMark).not.toHaveBeenCalled();
    expect(libraryAPI.marks).not.toHaveBeenCalled();
    expect(libraryAPI.highlights).not.toHaveBeenCalled();
  });
});

/** 본문 글자를 고른 것처럼 선택을 만들고 손을 뗀다. 고른 구절 도구가 뜰 때까지 기다린다. */
async function selectText(paragraphText: string, from: number, to: number) {
  const paragraph = await screen.findByText(paragraphText, { selector: ".verse__para" });
  const node = paragraph.firstChild as Text;
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.mouseUp(document);
  return within(await screen.findByRole("toolbar", { name: "고른 구절" }));
}

describe("구절 형광펜", () => {
  it("글자를 고르고 색을 누르면 그 구절만 칠한다(청크 오프셋·인용)", async () => {
    loggedIn();
    const view = await showWords();
    await waitFor(() => expect(libraryAPI.highlights).toHaveBeenCalled());
    const toolbar = await selectText("첫째 단락의 본문", 3, 6);
    fireEvent.click(toolbar.getByRole("button", { name: "초록 형광펜" }));
    await waitFor(() =>
      expect(libraryAPI.createHighlight).toHaveBeenCalledWith({
        volume: VOLUME,
        chunk_id: "c0",
        start_chunk_index: 0,
        start_offset: 3,
        end_chunk_index: 0,
        end_offset: 6,
        quote: "단락의",
        color: 2,
      }),
    );
    await waitFor(() => expect(view.container.querySelector("mark.hl-2")).toHaveTextContent(/^단락의$/));
    // 칠하고 나면 선택과 도구가 사라진다
    expect(screen.queryByRole("toolbar", { name: "고른 구절" })).toBeNull();
    expect(window.getSelection()?.isCollapsed).toBe(true);
    // 다음 새 구절의 기본색이 된다
    expect(localStorage.getItem("hoondok:hl-color")).toBe("2");
  });
  it("저장에 실패하면 칠을 되돌리고 알린다", async () => {
    loggedIn();
    vi.mocked(libraryAPI.createHighlight).mockRejectedValue(new ApiError(422, { message: "invalid" }));
    const view = await showWords();
    await waitFor(() => expect(libraryAPI.highlights).toHaveBeenCalled());
    const toolbar = await selectText("첫째 단락의 본문", 3, 6);
    fireEvent.click(toolbar.getByRole("button", { name: "노랑 형광펜" }));
    expect(await screen.findByText(/기록을 저장하지 못했어요/)).toBeInTheDocument();
    expect(view.container.querySelector("mark.hl")).toBeNull();
  });
  it("칠한 구절을 누르면 형광펜 도구가 뜨고, 지우기는 되돌리기 알림을 보인다(메모까지 되살린다)", async () => {
    loggedIn();
    serverHighlights = [highlight({ note: "기억할 문장" })];
    const view = await showWords();
    await waitFor(() => expect(view.container.querySelector("mark.hl-2")).not.toBeNull());
    fireEvent.click(view.container.querySelector("mark.hl-2") as HTMLElement);
    const popover = within(await screen.findByRole("toolbar", { name: "칠한 구절" }));
    expect(popover.getByRole("button", { name: "초록 형광펜" })).toHaveAttribute("aria-pressed", "true");
    // 지금 색을 다시 눌러도 지우지 않는다(예전 P0: 같은 색 재탭이 메모까지 조용히 지웠다)
    fireEvent.click(popover.getByRole("button", { name: "초록 형광펜" }));
    expect(libraryAPI.deleteHighlight).not.toHaveBeenCalled();

    fireEvent.click(view.container.querySelector("mark.hl-2") as HTMLElement);
    fireEvent.click(
      within(await screen.findByRole("toolbar", { name: "칠한 구절" })).getByRole("button", { name: "지우기" }),
    );
    await waitFor(() => expect(libraryAPI.deleteHighlight).toHaveBeenCalledWith("h1"));
    await waitFor(() => expect(view.container.querySelector("mark.hl")).toBeNull());
    expect(await screen.findByText("형광펜을 지웠어요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    await waitFor(() =>
      expect(libraryAPI.createHighlight).toHaveBeenCalledWith({
        volume: VOLUME,
        chunk_id: "c0",
        start_chunk_index: 0,
        start_offset: 3,
        end_chunk_index: 0,
        end_offset: 6,
        quote: "단락의",
        color: 2,
        note: "기억할 문장",
      }),
    );
    await waitFor(() => expect(view.container.querySelector("mark.hl-2")).toHaveTextContent("단락의"));
  });
  it("형광펜 도구에서 다른 색을 고르면 색만 바꾼다", async () => {
    loggedIn();
    serverHighlights = [highlight()];
    const view = await showWords();
    await waitFor(() => expect(view.container.querySelector("mark.hl-2")).not.toBeNull());
    fireEvent.click(view.container.querySelector("mark.hl-2") as HTMLElement);
    fireEvent.click(
      within(await screen.findByRole("toolbar", { name: "칠한 구절" })).getByRole("button", { name: "노랑 형광펜" }),
    );
    await waitFor(() => expect(libraryAPI.updateHighlight).toHaveBeenCalledWith("h1", { color: 1 }));
    await waitFor(() => expect(view.container.querySelector("mark.hl-1")).toHaveTextContent("단락의"));
  });
  it("새 구절에 메모를 남기면 저장을 누를 때 형광펜과 함께 만든다", async () => {
    loggedIn();
    await showWords();
    await waitFor(() => expect(libraryAPI.highlights).toHaveBeenCalled());
    const toolbar = await selectText("둘째 단락의 본문", 0, 2);
    fireEvent.click(toolbar.getByRole("button", { name: "메모" }));
    const sheet = within(await screen.findByRole("dialog", { name: "메모" }));
    expect(sheet.getByText("둘째")).toBeInTheDocument();
    // 아무것도 적지 않으면 저장하지 않는다 — 메모를 열었다고 형광펜이 생기지 않는다
    expect(sheet.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(libraryAPI.createHighlight).not.toHaveBeenCalled();
    fireEvent.change(sheet.getByLabelText("메모"), { target: { value: " 오늘 붙들 말씀 " } });
    fireEvent.click(sheet.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(libraryAPI.createHighlight).toHaveBeenCalledWith({
        volume: VOLUME,
        chunk_id: "c1",
        start_chunk_index: 1,
        start_offset: 0,
        end_chunk_index: 1,
        end_offset: 2,
        quote: "둘째",
        color: 1,
        note: "오늘 붙들 말씀",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("메모를 저장했어요")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "메모 보기" })).toBeInTheDocument();
  });
  it("메모 표지를 누르면 메모를 고치고, 비워서 저장하면 메모만 지운다", async () => {
    loggedIn();
    serverHighlights = [highlight({ note: "기억할 문장" })];
    const view = await showWords();
    fireEvent.click(await screen.findByRole("button", { name: "메모 보기" }));
    let sheet = within(await screen.findByRole("dialog", { name: "메모" }));
    expect(sheet.getByLabelText("메모")).toHaveValue("기억할 문장");
    fireEvent.change(sheet.getByLabelText("메모"), { target: { value: "고친 생각" } });
    fireEvent.click(sheet.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(libraryAPI.updateHighlight).toHaveBeenCalledWith("h1", { note: "고친 생각" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(await screen.findByRole("button", { name: "메모 보기" }));
    sheet = within(await screen.findByRole("dialog", { name: "메모" }));
    expect(sheet.getByLabelText("메모")).toHaveValue("고친 생각");
    fireEvent.change(sheet.getByLabelText("메모"), { target: { value: "  " } });
    expect(sheet.getByText("비워서 저장하면 메모만 지워지고 형광펜은 남아요.")).toBeInTheDocument();
    fireEvent.click(sheet.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(libraryAPI.updateHighlight).toHaveBeenLastCalledWith("h1", { note: null }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "메모 보기" })).toBeNull());
    expect(view.container.querySelector("mark.hl-2")).toHaveTextContent("단락의");
    expect(libraryAPI.deleteHighlight).not.toHaveBeenCalled();
  });
  it("메모 저장이 실패하면 시트를 닫지 않고 적은 글을 지킨다", async () => {
    loggedIn();
    serverHighlights = [highlight({ note: "기억할 문장" })];
    vi.mocked(libraryAPI.updateHighlight).mockRejectedValue(new ApiError(500, { message: "down" }));
    await showWords();
    fireEvent.click(await screen.findByRole("button", { name: "메모 보기" }));
    const sheet = within(await screen.findByRole("dialog", { name: "메모" }));
    fireEvent.change(sheet.getByLabelText("메모"), { target: { value: "지켜야 할 글" } });
    fireEvent.click(sheet.getByRole("button", { name: "저장" }));
    expect(await sheet.findByText(/기록을 저장하지 못했어요/)).toBeInTheDocument();
    expect(sheet.getByLabelText("메모")).toHaveValue("지켜야 할 글");
    expect(sheet.getByRole("button", { name: "저장" })).toBeEnabled();
  });
  it("비로그인은 색·메모를 누르면 로그인 안내를 보고 아무것도 보내지 않는다", async () => {
    await showWords();
    const toolbar = await selectText("첫째 단락의 본문", 0, 2);
    fireEvent.click(toolbar.getByRole("button", { name: "노랑 형광펜" }));
    const gate = within(await screen.findByRole("dialog", { name: "형광펜·메모" }));
    expect(gate.getByText("로그인하면 기록이 남아요")).toBeInTheDocument();
    expect(gate.getByRole("link", { name: "로그인하고 표시하기" }).getAttribute("href")).toContain(
      "/hoondok/onboarding",
    );
    expect(libraryAPI.createHighlight).not.toHaveBeenCalled();
    expect(libraryAPI.highlights).not.toHaveBeenCalled();
  });
  it("복사는 로그인 없이 인용과 출처를 함께 담는다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      await showWords();
      const toolbar = await selectText("첫째 단락의 본문", 3, 9);
      fireEvent.click(toolbar.getByRole("button", { name: "복사" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("단락의 본문\n\n말씀선집 001권 · 단락 1"));
      expect(await screen.findByText("복사했어요")).toBeInTheDocument();
      writeText.mockRejectedValueOnce(new Error("denied"));
      fireEvent.click((await selectText("둘째 단락의 본문", 0, 2)).getByRole("button", { name: "복사" }));
      expect(await screen.findByText(/복사하지 못했어요/)).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });
  it("Esc 로 고른 구절 도구를 닫는다", async () => {
    await showWords();
    await selectText("첫째 단락의 본문", 0, 2);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "고른 구절" })).toBeNull());
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });
  it("형광펜이 하나도 없으면 첫 사용 안내를 보이고, 닫으면 이 기기에서 다시 보이지 않는다", async () => {
    const view = await showWords();
    const hint = await screen.findByText(/글자를 길게 누르면 원하는 구절에 형광펜과 메모를/);
    fireEvent.click(within(hint).getByRole("button", { name: "알겠어요" }));
    expect(screen.queryByText(/글자를 길게 누르면 원하는 구절에/)).toBeNull();
    expect(localStorage.getItem("hoondok:hl-hint-dismissed")).toBe("1");
    view.unmount();
    await showWords();
    await screen.findByText("첫째 단락의 본문");
    expect(screen.queryByText(/글자를 길게 누르면 원하는 구절에/)).toBeNull();
  });
  it("읽기 도구는 형광펜·노트·목차 셋이다: 형광펜은 고르는 법을 알리고 노트는 노트 탭으로 간다", async () => {
    await showWords();
    await screen.findByText("첫째 단락의 본문");
    // 폰·태블릿 하단 독과 ≥1024px 가로 툴바가 같은 도구를 보인다. 북마크는 단락 시트에서만 한다
    const bars = screen.getAllByLabelText("읽기 도구");
    expect(bars).toHaveLength(2);
    for (const bar of bars)
      expect(
        within(bar)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["형광펜", "노트", "목차"]);
    const bar = bars[1];
    fireEvent.click(within(bar).getByRole("button", { name: "형광펜" }));
    expect(
      await screen.findByText("칠할 구절을 길게 눌러 고르세요. PC에서는 끌어서 고를 수 있어요."),
    ).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "노트" }));
    expect(screen.getByRole("tab", { name: "노트" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("노트 탭", () => {
  it("이 권의 형광펜을 본문 순서로 색 이름·단락·메모와 함께 모은다", async () => {
    loggedIn();
    serverHighlights = [
      highlight({
        id: "late",
        chunk_id: "c1",
        start_chunk_index: 1,
        end_chunk_index: 1,
        start_offset: 0,
        end_offset: 2,
        quote: "둘째",
        color: 3,
      }),
      highlight({ id: "early", note: "붙들 말씀", color: 1 }),
    ];
    await showWords();
    fireEvent.click(await screen.findByRole("tab", { name: "노트" }));
    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["노랑 · 단락 1단락의붙들 말씀", "분홍 · 단락 2둘째"]);
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", wordsHref(VOLUME, "c0"));
    // 누르면 본문 탭으로 돌아간다(같은 화면 안 이동이라 탭 상태가 남지 않게). jsdom 의 문서 이동은 막는다
    const stayHere = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("click", stayHere);
    fireEvent.click(within(items[1]).getByRole("link"));
    document.removeEventListener("click", stayHere);
    expect(screen.getByRole("tab", { name: "본문" })).toHaveAttribute("aria-selected", "true");
  });
  it("비어 있으면 길게 눌러 고르는 법을 알린다", async () => {
    loggedIn();
    await showWords();
    fireEvent.click(await screen.findByRole("tab", { name: "노트" }));
    expect(await screen.findByText("이 권에 남긴 형광펜·메모가 아직 없어요")).toBeInTheDocument();
    expect(screen.getByText(/본문 글자를 길게 누르면/)).toBeInTheDocument();
  });
  it("비로그인은 로그인 안내를 보인다", async () => {
    await showWords();
    fireEvent.click(await screen.findByRole("tab", { name: "노트" }));
    expect(screen.getByText("로그인하면 기록이 남아요")).toBeInTheDocument();
    expect(libraryAPI.highlights).not.toHaveBeenCalled();
  });
});

describe("AI 설명 탭", () => {
  it("고른 단락만 고정 질문으로 한 번 요청한다", async () => {
    vi.mocked(requestAsk).mockResolvedValue({
      answer: "쉬운 설명",
      sources: [{ text: "근거" }] as never,
      disclaimer: "",
    });
    await showWords();
    fireEvent.click(await screen.findByRole("button", { name: "단락 2 표시하기" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getByRole("tab", { name: "AI 설명" }));
    fireEvent.click(screen.getByRole("button", { name: "이 단락 설명 요청" }));
    await waitFor(() => expect(screen.getByText("쉬운 설명")).toBeInTheDocument());
    expect(requestAsk).toHaveBeenCalledTimes(1);
    expect(requestAsk).toHaveBeenCalledWith(`${EXPLAIN_PREFIX}둘째 단락의 본문`);
  });
  it("답의 마크다운 기호를 드러내지 않고 소제목·강조로 그린다", async () => {
    vi.mocked(requestAsk).mockResolvedValue({
      answer: "### 한 줄 요약\n변치 않는 **뼈사랑**입니다.",
      sources: [{ text: "근거" }] as never,
      disclaimer: "",
    });
    await showWords();
    fireEvent.click(await screen.findByRole("button", { name: "단락 2 표시하기" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getByRole("tab", { name: "AI 설명" }));
    fireEvent.click(screen.getByRole("button", { name: "이 단락 설명 요청" }));
    expect(await screen.findByText("한 줄 요약", { selector: ".ai-note__head" })).toBeInTheDocument();
    expect(screen.getByText("뼈사랑").tagName).toBe("STRONG");
    expect(screen.queryByText(/###|\*\*/)).toBeNull();
  });
  it("근거가 0건이면 답을 보이지 않는다", async () => {
    vi.mocked(requestAsk).mockResolvedValue({ answer: "보이면 안 되는 답", sources: [], disclaimer: "" });
    await showWords();
    fireEvent.click(await screen.findByRole("button", { name: "단락 1 표시하기" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getByRole("tab", { name: "AI 설명" }));
    fireEvent.click(screen.getByRole("button", { name: "이 단락 설명 요청" }));
    await waitFor(() => expect(screen.getByText(/근거 말씀을 찾지 못했어요/)).toBeInTheDocument());
    expect(screen.queryByText("보이면 안 되는 답")).toBeNull();
  });
});

describe("듣기 바", () => {
  it("음성 합성이 없는 브라우저는 한 줄 안내만 보인다", async () => {
    await showWords();
    expect(await screen.findByText("이 브라우저는 소리 내어 읽기를 지원하지 않아요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "듣기 시작" })).toBeNull();
  });
  it("읽는 단락을 표시하고 구간 끝에서 다음 구간 링크만 보인다(자동 이동 없음)", async () => {
    const spoken: { onend: (() => void) | null }[] = [];
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (utterance: { onend: (() => void) | null }) => spoken.push(utterance),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getVoices: () => [{ lang: "ko-KR", name: "유나" }],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: class {
        onend: (() => void) | null = null;
        constructor(readonly text: string) {}
      },
    });
    try {
      const view = await showWords();
      // 재생 전에는 총 단락 수만 보인다
      expect(await screen.findByText("2단락")).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "듣기 시작" }));
      await waitFor(() => expect(document.getElementById("verse-0")).toHaveClass("verse--speaking"));
      expect(screen.getByRole("progressbar", { name: "듣기 진행" })).toHaveAttribute("aria-valuenow", "1");
      // 하단 독에 미니 플레이어가 붙는다 — 위 듣기 바가 스크롤로 접혀도 여기서 멈출 수 있다
      expect(screen.getByRole("button", { name: "일시정지 · 단락 1 / 2" })).toBeInTheDocument();
      act(() => spoken[0].onend?.());
      await waitFor(() => expect(document.getElementById("verse-1")).toHaveClass("verse--speaking"));
      act(() => spoken[1].onend?.());
      expect(await screen.findByRole("link", { name: "다음 구간 이어 듣기" })).toHaveAttribute(
        "href",
        `${wordsHref(VOLUME)}?page=2`,
      );
      expect(view.container.querySelector(".verse--speaking")).toBeNull();
      expect(screen.getByText("2단락")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /· 단락/ })).toBeNull();
    } finally {
      Reflect.deleteProperty(window, "speechSynthesis");
      Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
    }
  });
});

describe("이 단락부터 듣기", () => {
  it("단락 시트의 버튼은 그 단락부터 읽기 시작하고 시트를 닫는다", async () => {
    const spoken: { text: string }[] = [];
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (utterance: { text: string }) => spoken.push(utterance),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getVoices: () => [{ lang: "ko-KR", name: "유나" }],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: class {
        onend: (() => void) | null = null;
        constructor(readonly text: string) {}
      },
    });
    try {
      await showWords();
      await screen.findByRole("button", { name: "듣기 시작" });
      // 듣기는 로그인과 무관하다 — 비로그인 안내 시트에도 버튼이 있다
      fireEvent.click(await screen.findByRole("button", { name: "단락 2 표시하기" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "이 단락부터 듣기" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(spoken.map((utterance) => utterance.text)).toEqual(["둘째 단락의 본문"]);
      await waitFor(() => expect(document.getElementById("verse-1")).toHaveClass("verse--speaking"));
      expect(screen.getByRole("progressbar", { name: "듣기 진행" })).toHaveAttribute("aria-valuenow", "2");

      // 읽는 중에도 다른 단락을 고르면 그 단락부터 다시 읽는다
      fireEvent.click(screen.getByRole("button", { name: "단락 1 표시하기" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "이 단락부터 듣기" }));
      expect(spoken.at(-1)?.text).toBe("첫째 단락의 본문");
      await waitFor(() => expect(document.getElementById("verse-0")).toHaveClass("verse--speaking"));
    } finally {
      Reflect.deleteProperty(window, "speechSynthesis");
      Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
    }
  });
  it("소리 내어 읽을 수 없는 브라우저는 시트에 듣기 버튼을 두지 않는다", async () => {
    await showWords();
    await screen.findByText("이 브라우저는 소리 내어 읽기를 지원하지 않아요.");
    fireEvent.click(await screen.findByRole("button", { name: "단락 1 표시하기" }));
    const sheet = within(await screen.findByRole("dialog"));
    expect(sheet.queryByRole("button", { name: "이 단락부터 듣기" })).toBeNull();
  });
});

describe("이어 읽기", () => {
  it("로그인 사용자는 페이지마다 한 번만 서버에 위치를 남긴다", async () => {
    loggedIn();
    const view = await showWords();
    await waitFor(() => expect(libraryAPI.saveReadingPosition).toHaveBeenCalledWith(VOLUME, 0));
    view.rerender(<div />);
    expect(libraryAPI.saveReadingPosition).toHaveBeenCalledTimes(1);
  });
  it("비로그인은 서버를 부르지 않고 기기에만 남긴다", async () => {
    await showWords();
    await screen.findByText("첫째 단락의 본문");
    expect(libraryAPI.saveReadingPosition).not.toHaveBeenCalled();
    expect(libraryAPI.readingPositions).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("hoondok:read:last") ?? "null")).toEqual({ volume: VOLUME, page: 1 });
  });
  it("서버 값이 있으면 서버 위치를 이어 읽기로 보인다", async () => {
    loggedIn();
    vi.mocked(libraryAPI.readingPositions).mockResolvedValue({
      items: [
        {
          volume: VOLUME,
          chunk_index: 42,
          updated_at: "2026-09-23T00:00:00Z",
          work_title: "말씀선집 001권",
          series: SERIES,
          label: "001권",
        },
      ],
    });
    show(LibraryPage());
    expect(await screen.findByRole("heading", { name: "이어 읽기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /단락 43까지 읽었어요/ })).toHaveAttribute(
      "href",
      `${wordsHref(VOLUME)}?page=3`,
    );
    expect(libraryAPI.saveReadingPosition).not.toHaveBeenCalled();
  });
  it("서버가 비어 있고 기기에만 기록이 있으면 한 번 올린다", async () => {
    loggedIn();
    writeLastReading({ volume: VOLUME, page: 2 });
    show(LibraryPage());
    await waitFor(() => expect(libraryAPI.saveReadingPosition).toHaveBeenCalledWith(VOLUME, 20));
    expect(libraryAPI.saveReadingPosition).toHaveBeenCalledTimes(1);
  });
  it("북마크 절은 최근 5건만 보이고 비로그인은 조회하지 않는다", async () => {
    show(LibraryPage());
    await screen.findByRole("link", { name: /문선명선생 말씀선집/ });
    expect(screen.queryByRole("heading", { name: "북마크" })).toBeNull();
    expect(libraryAPI.marks).not.toHaveBeenCalled();
  });
  it("로그인하면 북마크 절이 원문 청크로 연결된다", async () => {
    loggedIn();
    vi.mocked(libraryAPI.marks).mockResolvedValue({
      items: Array.from({ length: 6 }, (_, index) => ({
        chunk_id: `b${index}`,
        chunk_index: index,
        volume: VOLUME,
        kind: "bookmark" as const,
        color: null,
        note: null,
        updated_at: "2026-09-23T00:00:00Z",
        work_title: "말씀선집 001권",
        label: "001권",
      })),
    });
    show(LibraryPage());
    expect(await screen.findByRole("heading", { name: "북마크" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /단락 1$/ })).toHaveAttribute("href", wordsHref(VOLUME, "b0"));
    expect(screen.queryByRole("link", { name: /단락 6$/ })).toBeNull();
  });
});
