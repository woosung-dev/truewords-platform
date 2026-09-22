import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/hoondok/library";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
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

import LibraryPage from "@/app/(hoondok)/hoondok/library/page";
import SearchPage from "@/app/(hoondok)/hoondok/search/page";
import WordsPage from "@/app/(hoondok)/hoondok/words/[id]/page";
import { HoondokAppShell } from "@/components/hoondok";
import { libraryAPI, wordsHref } from "@/features/hoondok/library/api";
import { parseLastReading, writeLastReading } from "@/features/hoondok/library/last-reading";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { identityAPI } from "@/features/identity/api";

function show(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}
const WORK = {
  volume: "말씀 1권.txt",
  work_title: "말씀 1권",
  scope_search: true,
  scope_full_text: true,
  source_keys: ["A"],
  book_series: null,
  authority_grade: "R" as const,
};
const WORDS = {
  ...WORK,
  page: 2,
  page_size: 20,
  total_chunks: 41,
  total_pages: 3,
  chunks: [{ chunk_id: "chunk-21", chunk_index: 20, text: "둘째 구간의 본문" }],
  body: "둘째 구간의 본문",
};
const RESULT = {
  chunk_id: "chunk-21",
  chunk_index: 20,
  volume: WORK.volume,
  work_title: WORK.work_title,
  authority_grade: "R" as const,
  text: "참사랑 말씀",
  score: 0.8,
  can_read_full_text: true,
};

beforeEach(() => {
  pathname = "/hoondok/library";
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", "");
  vi.mocked(libraryAPI.list).mockResolvedValue({ items: [WORK] });
  vi.mocked(libraryAPI.search).mockResolvedValue({ results: [RESULT] });
  vi.mocked(libraryAPI.words).mockResolvedValue(WORDS);
  vi.mocked(libraryAPI.sections).mockResolvedValue({ volume: WORK.volume, sections: [] });
  vi.mocked(libraryAPI.marks).mockResolvedValue({ items: [] });
  vi.mocked(libraryAPI.readingPositions).mockResolvedValue({ items: [] });
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "unauthorized" }));
});
afterEach(() => vi.unstubAllEnvs());

function search(value: string) {
  fireEvent.change(screen.getByLabelText("말씀 검색"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "찾기" }));
}

describe("말씀 서고", () => {
  it("프리뷰 OFF 에도 실데이터 저작물과 URL 인코딩 링크를 보인다", async () => {
    show(LibraryPage());
    expect(await screen.findByRole("link", { name: /말씀 1권/ })).toHaveAttribute("href", wordsHref(WORK.volume));
    expect(screen.queryByText("미리보기 예시 데이터입니다")).toBeNull();
  });
  it("검색전용 저작물에는 원문 링크 대신 사유와 검색 진입을 표시한다", async () => {
    vi.mocked(libraryAPI.list).mockResolvedValue({ items: [{ ...WORK, scope_full_text: false }] });
    show(LibraryPage());
    expect(await screen.findByText("검색 인용만 허용 · 원문 공개 확인 중")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /말씀 1권/ })).toBeNull();
    expect(screen.getByRole("link", { name: "말씀 검색하기" })).toHaveAttribute("href", "/hoondok/search");
  });
  it("기기의 마지막 원문 구간은 현재 원문 권리가 허용된 경우에만 이어 읽기에 보인다", async () => {
    writeLastReading({ volume: WORK.volume, page: 2 });
    const view = show(LibraryPage());
    expect(await screen.findByRole("heading", { name: "이어 읽기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /말씀 1권.*원문 구간 2/ })).toHaveAttribute(
      "href",
      `${wordsHref(WORK.volume)}?page=2`,
    );
    view.unmount();
    vi.mocked(libraryAPI.list).mockResolvedValue({ items: [{ ...WORK, scope_full_text: false }] });
    show(LibraryPage());
    await screen.findByText("검색 인용만 허용 · 원문 공개 확인 중");
    expect(screen.queryByRole("heading", { name: "이어 읽기" })).toBeNull();
  });
  it("없는 기록이나 깨진 기록은 이어 읽기와 가짜 제목을 만들지 않는다", async () => {
    for (const raw of [
      null,
      "broken",
      JSON.stringify({ volume: "말씀", page: 0 }),
      JSON.stringify({ volume: "말씀", page: 1.5 }),
    ])
      expect(parseLastReading(raw)).toBeNull();
    show(LibraryPage());
    await screen.findByRole("link", { name: /말씀 1권/ });
    expect(screen.queryByRole("heading", { name: "이어 읽기" })).toBeNull();
  });
  it("권리가 비어 있으면 오늘 훈독으로 돌아갈 수 있다", async () => {
    vi.mocked(libraryAPI.list).mockResolvedValue({ items: [] });
    show(LibraryPage());
    expect(await screen.findByText("공개된 저작물이 아직 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "오늘 훈독으로 돌아가기" })).toHaveAttribute("href", "/hoondok");
  });
  it("volume 이 저작물 제목과 같으면 같은 글자를 두 줄 쓰지 않는다", async () => {
    const same = { ...WORK, volume: "말씀선집 001권", work_title: "말씀선집 001권" };
    vi.mocked(libraryAPI.list).mockResolvedValue({ items: [same] });
    show(LibraryPage());
    expect(await screen.findAllByText("말씀선집 001권")).toHaveLength(1);
  });
  it("오류는 0건으로 가장하지 않고 재시도한다", async () => {
    vi.mocked(libraryAPI.list).mockRejectedValueOnce(new Error("down"));
    show(LibraryPage());
    fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("link", { name: /말씀 1권/ })).toBeInTheDocument();
  });
});
describe("말씀 검색", () => {
  it("검색 결과에서 인용 청크가 포함된 원문 구간으로 이동한다", async () => {
    show(SearchPage());
    search("참사랑");
    expect(await screen.findByRole("link", { name: /참사랑 말씀/ })).toHaveAttribute(
      "href",
      wordsHref(WORK.volume, "chunk-21"),
    );
    expect(libraryAPI.search).toHaveBeenCalledWith("참사랑", expect.any(AbortSignal));
  });
  it("검색만 허용된 결과는 원문 링크를 만들지 않는다", async () => {
    vi.mocked(libraryAPI.search).mockResolvedValue({ results: [{ ...RESULT, can_read_full_text: false }] });
    show(SearchPage());
    search("참사랑");
    expect(await screen.findByText(/검색 인용만 허용/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /참사랑 말씀/ })).toBeNull();
  });
  it("0건과 장애를 구분하고 장애 때 입력을 보존한다", async () => {
    vi.mocked(libraryAPI.search).mockResolvedValueOnce({ results: [] }).mockRejectedValueOnce(new Error("down"));
    show(SearchPage());
    search("없는말");
    expect(await screen.findByText("검색 결과가 없어요")).toBeInTheDocument();
    search("다른말");
    expect(await screen.findByText("검색하지 못했어요")).toBeInTheDocument();
    expect(screen.getByLabelText("말씀 검색")).toHaveValue("다른말");
  });
  it("분류 칩은 입력만 채우고 검색하지 않는다", () => {
    show(SearchPage());
    fireEvent.click(screen.getByRole("button", { name: "탕감복귀" }));
    expect(screen.getByLabelText("말씀 검색")).toHaveValue("탕감복귀");
    expect(libraryAPI.search).not.toHaveBeenCalled();
  });
});
describe("원문 읽기", () => {
  async function showWords() {
    return show(
      await WordsPage({
        params: Promise.resolve({ id: encodeURIComponent(WORK.volume) }),
        searchParams: Promise.resolve({ chunk_id: "chunk-21" }),
      }),
    );
  }
  it("원문 구간·출처 결측·앞뒤 구간을 표시하고 열기만으로 완료하지 않는다", async () => {
    await showWords();
    expect(await screen.findByText("둘째 구간의 본문")).toBeInTheDocument();
    expect(libraryAPI.words).toHaveBeenCalledWith(
      WORK.volume,
      1,
      { chunkId: "chunk-21", section: undefined },
      expect.any(AbortSignal),
    );
    expect(screen.getByText("화자 확인되지 않음")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "다음 구간" })).toHaveAttribute("href", `${wordsHref(WORK.volume)}?page=3`);
    expect(missionsAPI.complete).not.toHaveBeenCalled();
    const button = await screen.findByRole("button", { name: "읽음" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByText("오늘 말씀 읽기를 마쳤어요.")).toBeInTheDocument();
    expect(localStorage.getItem("hoondok:pending:study")).not.toBeNull();
    expect(localStorage.getItem("hoondok:pending:read")).toBeNull();
  });
  it("앱바 제목과 겹치는 저작물 제목을 본문에서 반복하지 않는다", async () => {
    const same = { ...WORDS, volume: "말씀선집 001권", work_title: "말씀선집 001권" };
    vi.mocked(libraryAPI.words).mockResolvedValue(same);
    show(
      await WordsPage({
        params: Promise.resolve({ id: encodeURIComponent(same.volume) }),
        searchParams: Promise.resolve({}),
      }),
    );
    await screen.findByText("둘째 구간의 본문");
    // 목차 제목 1회뿐 — 앱바 h1(titleSource: "work") 와 중복되던 lede h2·출처 줄 volume 은 사라진다
    expect(screen.getAllByText("말씀선집 001권")).toHaveLength(1);
  });
  it("URL 경계에서 한 번만 복원해 한글·공백·퍼센트가 포함된 volume 을 보존한다", async () => {
    const volume = "말씀 100% %20권";
    show(
      await WordsPage({
        params: Promise.resolve({ id: encodeURIComponent(volume) }),
        searchParams: Promise.resolve({}),
      }),
    );
    await screen.findByText("둘째 구간의 본문");
    expect(libraryAPI.words).toHaveBeenCalledWith(
      volume,
      1,
      { chunkId: undefined, section: undefined },
      expect.any(AbortSignal),
    );
  });
  it("깨진 퍼센트 인코딩은 API 로 보내지 않고 404 다", async () => {
    await expect(
      WordsPage({ params: Promise.resolve({ id: "%broken" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(libraryAPI.words).not.toHaveBeenCalled();
  });
  it("실제 저작물 제목을 앱바에 반영하고 원문 구간 목록을 링크로 제공한다", async () => {
    pathname = `/hoondok/words/${encodeURIComponent(WORK.volume)}`;
    show(
      <HoondokAppShell>
        {
          await WordsPage({
            params: Promise.resolve({ id: encodeURIComponent(WORK.volume) }),
            searchParams: Promise.resolve({ page: "2" }),
          })
        }
      </HoondokAppShell>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: WORK.work_title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "원문 구간 1" })).toHaveAttribute(
      "href",
      `${wordsHref(WORK.volume)}?page=1`,
    );
    expect(screen.getByRole("link", { name: "원문 구간 2" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "원문 구간 3" })).toHaveAttribute(
      "href",
      `${wordsHref(WORK.volume)}?page=3`,
    );
    expect(JSON.parse(localStorage.getItem("hoondok:read:last") ?? "null")).toEqual({ volume: WORK.volume, page: 2 });
  });
  it("권리 철회 404 는 편성이나 예시 본문으로 대체하지 않는다", async () => {
    vi.mocked(libraryAPI.words).mockRejectedValue(new ApiError(404, { message: "not found" }));
    await showWords();
    expect(await screen.findByText("이 원문을 열 수 없어요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "읽음" })).toBeNull();
    expect(screen.getByRole("link", { name: "서고로 돌아가기" })).toBeInTheDocument();
  });
});
