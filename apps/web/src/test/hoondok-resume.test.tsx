// 홈 "말씀 읽기 · 이어 읽기" 카드(A1)와 원문 도착 표시. 고르는 규칙·문구는 순수 함수로, 화면은 홈 카드·원문 뷰로 본다.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { LibraryItem, ReadingPositionItem, SectionItem } from "@truewords/api-client-ts/types";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/hoondok",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/features/hoondok/library/api", async (original) => ({
  ...(await original<object>()),
  libraryAPI: {
    list: vi.fn(),
    words: vi.fn(),
    sections: vi.fn(),
    readingPositions: vi.fn(),
    saveReadingPosition: vi.fn(),
    marks: vi.fn(),
  },
}));
vi.mock("@/features/identity/api", () => ({ identityAPI: { me: vi.fn() } }));
vi.mock("@/features/hoondok/missions-api", () => ({ missionsAPI: { summary: vi.fn(), complete: vi.fn() } }));
vi.mock("@/features/hoondok/jeongseong-api", () => ({ jeongseongAPI: { today: vi.fn() } }));

import WordsPage from "@/app/(hoondok)/hoondok/words/[id]/page";
import { HomeMissions } from "@/features/hoondok/components/home-missions";
import { jeongseongAPI } from "@/features/hoondok/jeongseong-api";
import { libraryAPI, wordsHref } from "@/features/hoondok/library/api";
import { writeLastReading } from "@/features/hoondok/library/last-reading";
import {
  pickResume,
  type ResumeReading,
  resumeCard,
  resumeDayLabel,
  sectionAt,
} from "@/features/hoondok/library/resume";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { formatKstDate, type TodayResponse } from "@/features/hoondok/today";
import { identityAPI } from "@/features/identity/api";

const VOLUME = "천성경";
const ITEM: LibraryItem = {
  volume: VOLUME,
  work_title: "천성경",
  scope_search: true,
  scope_full_text: true,
  source_keys: ["O"],
  book_series: "cheonseong_gyeong",
  authority_grade: "O1",
};
const POSITION: ReadingPositionItem = {
  volume: VOLUME,
  chunk_index: 20,
  updated_at: "2026-09-28T01:00:00",
  work_title: "천성경",
  series: "cheonseong_gyeong",
  label: "천성경",
};
const SECTIONS: SectionItem[] = [
  {
    position: 1,
    level: 1,
    title: "참부모님의 생애노정",
    start_chunk_index: 0,
    end_chunk_index: 39,
    spoken_on: null,
    place: null,
  },
  {
    position: 2,
    level: 2,
    title: "참부모님의 탄생",
    start_chunk_index: 0,
    end_chunk_index: 19,
    spoken_on: null,
    place: null,
  },
  {
    position: 3,
    level: 2,
    title: "참사랑은 직단거리를 갑니다",
    start_chunk_index: 20,
    end_chunk_index: 39,
    spoken_on: null,
    place: null,
  },
];
const TODAY = "2026-09-29";
const ACCOUNT: ResumeReading = {
  source: "account",
  volume: VOLUME,
  chunkIndex: 20,
  workTitle: "천성경",
  label: "천성경",
  updatedAt: null,
  authorityGrade: "O1",
};

describe("이어 읽기 고르기", () => {
  it("로그인은 서버 기록 첫 항목을 고르고 기기 기록은 보지 않는다", () => {
    const resume = pickResume({
      isLoggedIn: true,
      positions: [POSITION, { ...POSITION, volume: "평화경", chunk_index: 0 }],
      device: { volume: "평화경", page: 3 },
      items: [ITEM, { ...ITEM, volume: "평화경", work_title: "평화경" }],
    });
    expect(resume).toMatchObject({ source: "account", volume: VOLUME, chunkIndex: 20, updatedAt: POSITION.updated_at });
  });
  it("서버 기록이 없으면 로그인 사용자는 기록 없음이다", () => {
    expect(
      pickResume({ isLoggedIn: true, positions: [], device: { volume: VOLUME, page: 2 }, items: [ITEM] }),
    ).toBeNull();
  });
  it("비로그인은 기기 기록의 원문 구간을 첫 단락 번호로 환산한다", () => {
    const resume = pickResume({ isLoggedIn: false, positions: [], device: { volume: VOLUME, page: 3 }, items: [ITEM] });
    expect(resume).toMatchObject({
      source: "device",
      chunkIndex: 40,
      label: null,
      updatedAt: null,
      workTitle: "천성경",
    });
  });
  it("원문 공개가 닫혔거나 서고에 없는 권은 고르지 않는다", () => {
    const closed = [{ ...ITEM, scope_full_text: false }];
    expect(pickResume({ isLoggedIn: true, positions: [POSITION], device: null, items: closed })).toBeNull();
    expect(
      pickResume({ isLoggedIn: false, positions: [], device: { volume: VOLUME, page: 1 }, items: closed }),
    ).toBeNull();
    expect(
      pickResume({ isLoggedIn: false, positions: [], device: { volume: "없는 권", page: 1 }, items: [ITEM] }),
    ).toBeNull();
  });
  it("기록이 없으면 아무것도 고르지 않는다", () => {
    expect(pickResume({ isLoggedIn: false, positions: [], device: null, items: [ITEM] })).toBeNull();
  });
});

describe("이어 읽기 문구", () => {
  it("편·장이 겹치면 원문 머리글처럼 더 좁은 장을 고른다", () => {
    expect(sectionAt(SECTIONS, 25)?.title).toBe("참사랑은 직단거리를 갑니다");
    expect(sectionAt(SECTIONS, 40)).toBeNull();
  });
  it("제목은 저작물 + 장, 메타는 원문 화면과 같은 단락 번호다", () => {
    expect(resumeCard(ACCOUNT, SECTIONS, TODAY)).toEqual({
      title: "천성경 · 참사랑은 직단거리를 갑니다",
      meta: "21단락부터 이어 읽어요",
      href: `${wordsHref(VOLUME)}?page=2&from=resume`,
    });
  });
  it("장 목차가 없는 권은 저작물 + 권 라벨, 메타에 원문 구간을 적는다", () => {
    const anthology = { ...ACCOUNT, workTitle: "문선명선생 말씀선집", label: "200권", chunkIndex: 40 };
    expect(resumeCard(anthology, [], TODAY)).toMatchObject({
      title: "문선명선생 말씀선집 200권",
      meta: "원문 구간 3 · 41단락부터 이어 읽어요",
    });
    // 라벨이 저작물 이름과 같으면 두 번 쓰지 않는다
    expect(resumeCard(ACCOUNT, [], TODAY).title).toBe("천성경");
  });
  it("기기 기록은 시각 없이 이 기기에서 읽던 곳이라고만 말한다", () => {
    const device: ResumeReading = { ...ACCOUNT, source: "device", label: null };
    expect(resumeCard(device, SECTIONS, TODAY).meta).toBe("21단락부터 이어 읽어요 · 이 기기에서 읽던 곳");
  });
  it("KST 오늘·어제만 붙이고 그보다 오래된 기록은 경과를 드러내지 않는다", () => {
    // 서버 시각은 naive UTC — 15:00Z 가 KST 자정이다
    expect(resumeDayLabel("2026-09-28T15:00:00", TODAY)).toBe("오늘");
    expect(resumeDayLabel("2026-09-29T14:59:59.999", TODAY)).toBe("오늘");
    expect(resumeDayLabel("2026-09-28T14:59:59", TODAY)).toBe("어제");
    expect(resumeDayLabel("2026-09-27T15:00:00Z", TODAY)).toBe("어제");
    expect(resumeDayLabel("2026-09-27T14:59:59Z", TODAY)).toBeNull();
    expect(resumeDayLabel("2026-09-28T23:30:00+09:00", TODAY)).toBe("어제");
    expect(resumeDayLabel(null, TODAY)).toBeNull();
    expect(resumeDayLabel("시각 아님", TODAY)).toBeNull();
    expect(resumeCard({ ...ACCOUNT, updatedAt: "2026-09-28T14:00:00" }, SECTIONS, TODAY).meta).toBe(
      "21단락부터 이어 읽어요 · 어제",
    );
  });
});

// ---------- 화면 ----------

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const DATE = formatKstDate().iso;
const PUBLIC = {
  date: DATE,
  status: "available",
  reading: {
    id: "regular",
    reading_date: DATE,
    title: "일반 편성",
    body: "일반 본문",
    speaker: "화자",
    spoken_on: null,
    work_title: "정본",
    edition: "판본",
    authority_grade: "O1",
    review_status: "reviewed",
    estimated_minutes: 3,
  },
} as TodayResponse;

function show(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}
function resumeMission() {
  return screen.getAllByRole("link").find((link) => link.textContent?.includes("말씀 읽기 · 이어 읽기"));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "unauthorized" }));
  vi.mocked(jeongseongAPI.today).mockResolvedValue({
    date: DATE,
    status: "none",
    reason: null,
    period_id: null,
    reading: null,
  } as never);
  vi.mocked(missionsAPI.summary).mockResolvedValue({
    today: { read: false, pray: false, study: false },
    week: [],
    streak_days: 0,
    best_streak_days: 0,
    total_days: 0,
  });
  vi.mocked(libraryAPI.list).mockResolvedValue({ items: [ITEM], works: [] });
  vi.mocked(libraryAPI.sections).mockResolvedValue({ volume: VOLUME, sections: SECTIONS });
  vi.mocked(libraryAPI.readingPositions).mockResolvedValue({ items: [] });
  vi.mocked(libraryAPI.marks).mockResolvedValue({ items: [] });
});

describe("홈 이어 읽기 카드", () => {
  it("로그인하면 계정의 마지막 자리를 보이고 그 구간으로 간다", async () => {
    vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
    vi.mocked(libraryAPI.readingPositions).mockResolvedValue({
      items: [{ ...POSITION, updated_at: new Date().toISOString() }],
    });
    show(<HomeMissions today={PUBLIC} todayWeekday={1} />);
    expect(await screen.findByText("천성경 · 참사랑은 직단거리를 갑니다")).toBeInTheDocument();
    expect(screen.getByText("21단락부터 이어 읽어요 · 오늘")).toBeInTheDocument();
    expect(resumeMission()).toHaveAttribute("href", `${wordsHref(VOLUME)}?page=2&from=resume`);
    expect(libraryAPI.sections).toHaveBeenCalledWith(VOLUME, expect.anything());
  });
  it("비로그인은 이 기기의 기록을 서고 권리로 확인해 보인다", async () => {
    writeLastReading({ volume: VOLUME, page: 1 });
    show(<HomeMissions today={PUBLIC} todayWeekday={1} />);
    expect(await screen.findByText("천성경 · 참부모님의 탄생")).toBeInTheDocument();
    expect(screen.getByText("1단락부터 이어 읽어요 · 이 기기에서 읽던 곳")).toBeInTheDocument();
    expect(resumeMission()).toHaveAttribute("href", `${wordsHref(VOLUME)}?page=1&from=resume`);
    expect(libraryAPI.readingPositions).not.toHaveBeenCalled();
  });
  it("기록이 없으면 서고 안내 그대로이고 서고 목록도 부르지 않는다", async () => {
    show(<HomeMissions today={PUBLIC} todayWeekday={1} />);
    expect(await screen.findByText("말씀 서고")).toBeInTheDocument();
    expect(screen.getByText("공개된 원문을 읽고 읽음으로 기록해요")).toBeInTheDocument();
    expect(resumeMission()).toHaveAttribute("href", "/hoondok/library");
    expect(libraryAPI.list).not.toHaveBeenCalled();
  });
  it("원문 공개가 닫힌 권이면 원문 링크를 만들지 않는다", async () => {
    writeLastReading({ volume: VOLUME, page: 1 });
    vi.mocked(libraryAPI.list).mockResolvedValue({ items: [{ ...ITEM, scope_full_text: false }], works: [] });
    show(<HomeMissions today={PUBLIC} todayWeekday={1} />);
    expect(await screen.findByText("말씀 서고")).toBeInTheDocument();
    expect(resumeMission()).toHaveAttribute("href", "/hoondok/library");
    expect(screen.queryByText(/단락부터/)).toBeNull();
  });
  it("위치 조회가 실패하면 기록 없음과 같은 카드로 떨어진다", async () => {
    vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
    vi.mocked(libraryAPI.readingPositions).mockRejectedValue(new ApiError(500, { message: "x" }));
    show(<HomeMissions today={PUBLIC} todayWeekday={1} />);
    expect(await screen.findByText("말씀 서고")).toBeInTheDocument();
    expect(resumeMission()).toHaveAttribute("href", "/hoondok/library");
  });
  it("불러오는 동안은 서고 문구를 먼저 보이지 않고 자리만 지킨다", async () => {
    writeLastReading({ volume: VOLUME, page: 1 });
    vi.mocked(libraryAPI.list).mockReturnValue(new Promise(() => {}));
    const view = show(<HomeMissions today={PUBLIC} todayWeekday={1} />);
    await waitFor(() => expect(libraryAPI.list).toHaveBeenCalled());
    expect(screen.queryByText("말씀 서고")).toBeNull();
    const card = resumeMission();
    expect(card).toHaveAttribute("aria-busy", "true");
    expect(within(view.container).getAllByText("", { selector: ".mission__skel" })).toHaveLength(2);
    // 제목 두 줄 높이를 잡는 표시 — 긴 제목이 와도 카드가 커지지 않는다
    expect(card?.closest(".mission")).toHaveAttribute("data-pending", "");
  });
});

describe("원문 이어 읽기 도착", () => {
  const WORDS = {
    volume: VOLUME,
    work_title: "천성경",
    authority_grade: "O1" as const,
    page: 2,
    page_size: 20,
    total_chunks: 40,
    total_pages: 2,
    section: { position: 3, level: 2, title: "참사랑은 직단거리를 갑니다" },
    chunks: [
      { chunk_id: "c20", chunk_index: 20, text: "스물한째 단락", display_text: "스물한째 단락" },
      { chunk_id: "c21", chunk_index: 21, text: "스물두째 단락", display_text: "스물두째 단락" },
    ],
    body: "스물한째 단락",
  };
  async function showWords(searchParams: Record<string, string>) {
    return show(
      await WordsPage({
        params: Promise.resolve({ id: encodeURIComponent(VOLUME) }),
        searchParams: Promise.resolve(searchParams),
      }),
    );
  }
  beforeEach(() => {
    vi.mocked(libraryAPI.words).mockResolvedValue(WORDS as never);
  });

  it("from=resume 이면 첫 단락 앞에 라벨을 두고 그 단락을 한 번 강조하며, 라벨이 화면 밖이면 라벨로 내린다", async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    // 라벨이 화면 아래에 있는 상황 — jsdom 은 레이아웃이 없어 위치를 직접 준다
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 2000, bottom: 2040 } as DOMRect);
    await showWords({ page: "2", from: "resume" });
    const label = (await screen.findByText("여기서부터 이어 읽어요")).closest("p");
    expect(label).toHaveAttribute("role", "status");
    expect(label).toHaveAttribute("id", "wd-resume");
    // 홈 카드의 "21단락부터" 와 원문의 단락 번호가 같다
    const first = screen.getByRole("button", { name: "단락 21 표시하기" }).closest("p");
    expect(first).toHaveClass("verse--arrive");
    expect(screen.getByRole("button", { name: "단락 22 표시하기" }).closest("p")).not.toHaveClass("verse--arrive");
    expect((label as Node).compareDocumentPosition(first as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 형광펜 본문(API-HD-053)과 함께 — 본문 article 은 한 겹이고 라벨은 그 밖, 첫 안내 뒤에 선다
    const articles = screen.getAllByRole("article", { name: "원문 본문" });
    expect(articles).toHaveLength(1);
    expect(articles[0]).toContainElement(first);
    expect(articles[0]).not.toContainElement(label);
    const hint = screen.getByText(/글자를 길게 누르면/);
    expect(hint.compareDocumentPosition(label as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(scroll.mock.contexts).toContain(label));
    // from 은 표시용 — 원문 API 로 보내지 않는다
    expect(libraryAPI.words).toHaveBeenCalledWith(
      VOLUME,
      2,
      { chunkId: undefined, section: undefined },
      expect.anything(),
    );
    rect.mockRestore();
  });
  it("라벨이 이미 화면 안에 있으면 스크롤하지 않는다 — 장 머리글을 가리지 않는다", async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 320, bottom: 352 } as DOMRect);
    await showWords({ page: "2", from: "resume" });
    await screen.findByText("여기서부터 이어 읽어요");
    expect(document.querySelector(".verse--arrive")).not.toBeNull();
    expect(scroll).not.toHaveBeenCalled();
    rect.mockRestore();
  });
  it("다른 경로로 들어오면 라벨도 강조도 없다", async () => {
    await showWords({ page: "2" });
    await screen.findByText("스물한째 단락");
    expect(screen.queryByText("여기서부터 이어 읽어요")).toBeNull();
    expect(document.querySelector(".verse--arrive")).toBeNull();
  });
});
