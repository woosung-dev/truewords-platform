// PLAN-HD-007 말씀 서고 3계층·읽기 기록. 기존 hoondok-library.test.tsx 가 검증한 평면 목록·검색은 그대로 두고
// 여기서는 저작물 → 권 → 장, 단락 표시, AI 설명, 이어 읽기 병합만 본다.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
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
    { chunk_id: "c0", chunk_index: 0, text: "첫째 단락의 본문" },
    { chunk_id: "c1", chunk_index: 1, text: "둘째 단락의 본문" },
  ],
  body: "첫째 단락의 본문",
};

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
    kind: "highlight",
    color: 1,
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
  it("단락 번호와 장 제목·단락 범위를 보인다", async () => {
    await showWords();
    expect(await screen.findByText("1장 이웃을 듣는 마음", { selector: ".masthead__nm" })).toBeInTheDocument();
    expect(screen.getByText("단락 0–1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "단락 1 표시하기" })).toBeInTheDocument();
    // 장이 날짜·장소를 가지면 결측 문구 대신 실제 값을 쓴다
    expect(screen.getByText("1956년 4월 8일")).toBeInTheDocument();
    expect(screen.queryByText("날짜 확인되지 않음")).toBeNull();
  });
  it("형광펜·북마크 표시를 본문에 반영한다", async () => {
    loggedIn();
    vi.mocked(libraryAPI.marks).mockResolvedValue({
      items: [
        {
          chunk_id: "c0",
          chunk_index: 0,
          volume: VOLUME,
          kind: "highlight",
          color: 2,
          note: "기억할 문장",
          updated_at: "2026-09-23T00:00:00Z",
          work_title: ITEM.work_title,
          label: "001권",
        },
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
    await waitFor(() => expect(view.container.querySelector("mark.hl-2")).toHaveTextContent("첫째 단락의 본문"));
    expect(view.container.querySelectorAll("mark")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "단락 1 표시하기" }).querySelector("svg")).not.toBeNull();
  });
});

const HIGHLIGHT_MARK = {
  chunk_id: "c0",
  chunk_index: 0,
  volume: VOLUME,
  kind: "highlight" as const,
  color: 2,
  note: null,
  updated_at: "2026-09-23T00:00:00Z",
  work_title: ITEM.work_title,
  label: "001권",
};

describe("단락 시트", () => {
  /** 단락 번호를 눌러 시트를 연다. 리더 바에도 같은 이름의 버튼이 있어 조회는 시트 안으로 좁힌다. */
  async function openSheet(chunkIndex: number) {
    fireEvent.click(await screen.findByRole("button", { name: `단락 ${chunkIndex} 표시하기` }));
    return within(await screen.findByRole("dialog"));
  }

  it("형광펜 색을 고르면 PUT, 같은 색을 다시 누르면 DELETE 한다", async () => {
    loggedIn();
    await showWords();
    const sheet = await openSheet(0);
    // 저장 성공이 표시 목록을 무효화하므로 다음 조회 결과를 먼저 바꿔 둔다
    vi.mocked(libraryAPI.marks).mockResolvedValue({ items: [HIGHLIGHT_MARK] });
    fireEvent.click(sheet.getByRole("button", { name: "연두 형광펜" }));
    await waitFor(() =>
      expect(libraryAPI.saveMark).toHaveBeenCalledWith("c0", {
        volume: VOLUME,
        chunk_index: 0,
        kind: "highlight",
        color: 2,
        note: null,
      }),
    );
    await waitFor(() =>
      expect(sheet.getByRole("button", { name: "연두 형광펜" })).toHaveAttribute("aria-pressed", "true"),
    );
    fireEvent.click(sheet.getByRole("button", { name: "연두 형광펜" }));
    await waitFor(() => expect(libraryAPI.deleteMark).toHaveBeenCalledWith("c0", "highlight"));
  });
  it("북마크는 토글이고 노트는 형광펜에 저장된다", async () => {
    loggedIn();
    await showWords();
    const sheet = await openSheet(0);
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
    fireEvent.change(sheet.getByLabelText(/노트/), { target: { value: " 기억할 문장 " } });
    fireEvent.click(sheet.getByRole("button", { name: "노트 저장" }));
    await waitFor(() =>
      expect(libraryAPI.saveMark).toHaveBeenCalledWith("c0", {
        volume: VOLUME,
        chunk_index: 0,
        kind: "highlight",
        color: 1,
        note: "기억할 문장",
      }),
    );
  });
  it("비로그인은 안내만 보이고 어떤 기록도 보내지 않는다", async () => {
    await showWords();
    const sheet = await openSheet(0);
    expect(sheet.getByText("로그인하면 기록이 남아요")).toBeInTheDocument();
    expect(sheet.queryByRole("button", { name: "노랑 형광펜" })).toBeNull();
    expect(libraryAPI.saveMark).not.toHaveBeenCalled();
    expect(libraryAPI.deleteMark).not.toHaveBeenCalled();
    expect(libraryAPI.marks).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByRole("button", { name: "단락 1 표시하기" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getByRole("tab", { name: "AI 설명" }));
    fireEvent.click(screen.getByRole("button", { name: "이 단락 설명 요청" }));
    await waitFor(() => expect(screen.getByText("쉬운 설명")).toBeInTheDocument());
    expect(requestAsk).toHaveBeenCalledTimes(1);
    expect(requestAsk).toHaveBeenCalledWith(`${EXPLAIN_PREFIX}둘째 단락의 본문`);
  });
  it("근거가 0건이면 답을 보이지 않는다", async () => {
    vi.mocked(requestAsk).mockResolvedValue({ answer: "보이면 안 되는 답", sources: [], disclaimer: "" });
    await showWords();
    fireEvent.click(await screen.findByRole("button", { name: "단락 0 표시하기" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getByRole("tab", { name: "AI 설명" }));
    fireEvent.click(screen.getByRole("button", { name: "이 단락 설명 요청" }));
    await waitFor(() => expect(screen.getByText(/근거 말씀을 찾지 못했어요/)).toBeInTheDocument());
    expect(screen.queryByText("보이면 안 되는 답")).toBeNull();
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
    expect(screen.getByRole("link", { name: /단락 42까지 읽었어요/ })).toHaveAttribute(
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
    expect(screen.getByRole("link", { name: /단락 0$/ })).toHaveAttribute("href", wordsHref(VOLUME, "b0"));
    expect(screen.queryByRole("link", { name: /단락 5$/ })).toBeNull();
  });
});
