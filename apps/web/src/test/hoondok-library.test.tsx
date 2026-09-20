import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SCR-PWA-007·008·009 말씀 프리뷰 셸 (PLAN-HD-002 W3-L).
// 플래그는 `flag.ts` 가 호출마다 process.env 를 읽으므로 stubEnv 만으로 ON/OFF 를 바꾼다(재import 불필요).
const { notFoundMock, loadTodayMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  loadTodayMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock, usePathname: () => "/hoondok/library" }));
vi.mock("@/features/hoondok/api", () => ({ loadToday: loadTodayMock }));

import HoondokLibraryPage from "@/app/(hoondok)/hoondok/library/page";
import HoondokSearchPage from "@/app/(hoondok)/hoondok/search/page";
import HoondokWordsPage from "@/app/(hoondok)/hoondok/words/[id]/page";
import { PREVIEW_WORD_ID } from "@/features/hoondok/preview/fixtures/library";

const RECENT_KEY = "hoondok:search:recent";
const NO_READING = { date: "2026-09-20", status: "none" as const, reading: null };

function wordsPage(id: string) {
  return HoondokWordsPage({ params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", "1");
  loadTodayMock.mockResolvedValue(NO_READING);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("훈독 말씀 프리뷰 플래그", () => {
  it("OFF 면 서고·검색·원문 세 페이지가 모두 notFound 를 부른다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", "");
    expect(() => HoondokLibraryPage()).toThrow("NEXT_NOT_FOUND");
    expect(() => HoondokSearchPage()).toThrow("NEXT_NOT_FOUND");
    await expect(wordsPage(PREVIEW_WORD_ID)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(3);
  });
});

describe("SCR-PWA-007 말씀 서고", () => {
  it("예시 고지·검색 진입·이어 읽기·저작물 선반을 보인다", () => {
    render(HoondokLibraryPage());
    expect(screen.getByText("미리보기 예시 데이터입니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /단어, 구절, 상황/ })).toHaveAttribute("href", "/hoondok/search");
    expect(screen.getByRole("link", { name: /천성경 제1편 3장/ })).toHaveAttribute(
      "href",
      `/hoondok/words/${PREVIEW_WORD_ID}`,
    );
    // 저작물 5종 중 권리 미확정 2종은 점선 배지로만 남고 링크가 아니다
    expect(screen.getAllByText("권리 확인 중")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /평화경/ })).toBeNull();
    expect(screen.getByText("권리 확인 중인 저작물은 검색·AI 근거에 쓰이지 않습니다")).toBeInTheDocument();
  });
});

describe("SCR-PWA-008 말씀 검색", () => {
  function submit(value: string) {
    fireEvent.change(screen.getByLabelText("말씀 검색"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "찾기" }));
  }

  it("제출해도 네트워크 요청이 없고 준비 중 상태와 예시 결과를 보인다", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(HoondokSearchPage());
    submit("참사랑");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("검색은 준비 중이에요");
    expect(screen.getByRole("link", { name: /참사랑은 직단거리를 갑니다/ })).toHaveAttribute(
      "href",
      `/hoondok/words/${PREVIEW_WORD_ID}`,
    );
  });

  it("맞는 예시가 없으면 0건 안내를 보인다", () => {
    render(HoondokSearchPage());
    submit("없는말");
    expect(screen.getByText("예시 결과가 없어요")).toBeInTheDocument();
    expect(screen.getByText("0건")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /참사랑은 직단거리를 갑니다/ })).toBeNull();
  });

  it("검색한 말은 기기 저장소에 최신순으로 남고 지우기로 비운다", () => {
    render(HoondokSearchPage());
    submit("정성");
    submit("참사랑");
    submit("정성"); // 같은 말은 한 번만 남고 맨 앞으로 온다
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")).toEqual(["정성", "참사랑"]);
    expect(screen.getByRole("heading", { name: "최근 검색" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")).toEqual([]);
    expect(screen.queryByRole("heading", { name: "최근 검색" })).toBeNull();
  });

  it("깨진 저장소 값은 최근 검색 없음으로 본다", () => {
    localStorage.setItem(RECENT_KEY, "{oops");
    render(HoondokSearchPage());
    expect(screen.queryByRole("heading", { name: "최근 검색" })).toBeNull();
  });

  it("분류 칩은 입력만 채우고 보내지 않는다", () => {
    render(HoondokSearchPage());
    fireEvent.click(screen.getByRole("button", { name: "탕감복귀" }));
    expect(screen.getByLabelText("말씀 검색")).toHaveValue("탕감복귀");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("SCR-PWA-009 원문 뷰", () => {
  it("fixture 에 없는 id 는 notFound 다", async () => {
    await expect(wordsPage("unknown-id")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("오늘 말씀이 없으면 fixture 단락·목차·형광펜 예시를 보인다", async () => {
    const { container } = render(await wordsPage(PREVIEW_WORD_ID));
    expect(screen.getByRole("heading", { name: "천성경 제1편 3장" })).toBeInTheDocument();
    expect(container.querySelectorAll(".verse")).toHaveLength(3);
    expect(container.querySelector("mark.hl-1")).toHaveTextContent("참사랑은 직단거리를 갑니다.");
    expect(screen.getByText("3장 참사랑은 직단거리를 갑니다")).toHaveAttribute("aria-current", "true");
  });

  it("세그먼트를 바꾸면 AI 설명·노트가 준비 중으로 바뀐다", async () => {
    const { container } = render(await wordsPage(PREVIEW_WORD_ID));
    fireEvent.click(screen.getByRole("tab", { name: "AI 설명" }));
    expect(container.querySelectorAll(".verse")).toHaveLength(0);
    expect(screen.getByText(/AI 설명은 준비 중이에요/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "노트" }));
    expect(screen.getByText("노트는 준비 중이에요")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "노트" })).toHaveAttribute("aria-selected", "true");
  });

  it("오늘 말씀이 편성돼 있으면 그 제목·출처·본문을 읽기 셸에 넣는다", async () => {
    loadTodayMock.mockResolvedValue({
      date: "2026-09-20",
      status: "available",
      reading: {
        id: "r-1",
        reading_date: "2026-09-20",
        title: "오늘 편성된 말씀",
        body: "첫 단락입니다.\n\n둘째 단락입니다.",
        speaker: "참아버님",
        spoken_on: null,
        work_title: "천성경",
        edition: "2013 한국어판",
        authority_grade: "O1",
        review_status: "verified",
      },
    });
    const { container } = render(await wordsPage(PREVIEW_WORD_ID));
    expect(screen.getByRole("heading", { name: "오늘 편성된 말씀" })).toBeInTheDocument();
    expect(container.querySelectorAll(".verse")).toHaveLength(2);
    expect(screen.getByText("첫 단락입니다.")).toBeInTheDocument();
  });

  it("읽기 도구는 누를 수 없는 표시이며 준비 중이라고 글자로 말한다", async () => {
    const { container } = render(await wordsPage(PREVIEW_WORD_ID));
    // 형광펜·노트·북마크·목차·설정 5개 × (폰 하단 바 · 데스크톱 상단 툴바) — 어느 쪽도 버튼이 아니다
    expect(container.querySelectorAll(".reader > span")).toHaveLength(10);
    expect(screen.queryByRole("button", { name: "형광펜" })).toBeNull();
    expect(screen.getByText("형광펜·노트·북마크·설정은 준비 중이에요")).toBeInTheDocument();
  });
});
