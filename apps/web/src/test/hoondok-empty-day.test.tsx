// 편성 없는 날(C3 안 A): 홈 주인공 판이 오늘 상태와 서고·검색 길을 말하고, 오늘의 실천은 이어 읽기 → 기도하기 그대로다.
// 훈독하기(/read)는 이어 읽기 → 서고. 대체 말씀은 없다.
// 이어 읽기 카드 데이터는 A1(useResumeCard) 그대로라 서고 API 만 바꿔 끼운다.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { JeongseongTodayResponse, LibraryItem, SectionItem } from "@truewords/api-client-ts/types";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/hoondok/library/api", async (original) => ({
  ...(await original<object>()),
  libraryAPI: { list: vi.fn(), sections: vi.fn(), readingPositions: vi.fn() },
}));
vi.mock("@/features/identity/api", () => ({ identityAPI: { me: vi.fn() } }));
vi.mock("@/features/hoondok/missions-api", () => ({ missionsAPI: { summary: vi.fn(), complete: vi.fn() } }));
vi.mock("@/features/hoondok/jeongseong-api", () => ({ jeongseongAPI: { today: vi.fn() } }));
vi.mock("@/features/hoondok/together/api", () => ({ togetherAPI: { today: vi.fn() } }));

import { HomeMissions, HomeTogether } from "@/features/hoondok/components/home-missions";
import { HomeWeek, HomeWord } from "@/features/hoondok/components/home-sky";
import { EffectiveReading } from "@/features/hoondok/jeongseong/components/effective-reading";
import { jeongseongAPI } from "@/features/hoondok/jeongseong-api";
import { libraryAPI, wordsHref } from "@/features/hoondok/library/api";
import { writeLastReading } from "@/features/hoondok/library/last-reading";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { writePending } from "@/features/hoondok/pending";
import { formatKstDate, type TodayResponse } from "@/features/hoondok/today";
import { togetherAPI } from "@/features/hoondok/together/api";
import { identityAPI } from "@/features/identity/api";

const DATE = formatKstDate().iso;
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
const SECTIONS: SectionItem[] = [
  {
    position: 1,
    level: 1,
    title: "참사랑의 근본",
    start_chunk_index: 0,
    end_chunk_index: 39,
    spoken_on: null,
    place: null,
  },
];
const EMPTY: TodayResponse = { date: DATE, status: "none", reading: null };
const WITHDRAWN: TodayResponse = { date: DATE, status: "withdrawn", reading: null };
const FAILED: TodayResponse = { ...EMPTY, error: "fetch failed" };
const AVAILABLE = {
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
const USER = { id: "u1", email: "a@b.c", display_name: "효진" };

function show(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}
/** 미션 목록의 카드 순서 — 종류 이름(자리만 잡은 카드는 빈 문자열) */
function missionOrder(container: HTMLElement) {
  return [...container.querySelectorAll(".missions > *")].map(
    (node) => node.querySelector(".mission__kind")?.textContent ?? "",
  );
}
const PRACTICE = ["말씀 읽기 · 이어 읽기", "기도하기 · 1분 · 준비 중"];

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
  } as JeongseongTodayResponse);
  vi.mocked(missionsAPI.summary).mockResolvedValue({
    today: { read: false, pray: false, study: false },
    week: [],
    streak_days: 12,
    best_streak_days: 12,
    total_days: 12,
  });
  vi.mocked(libraryAPI.list).mockResolvedValue({ items: [ITEM], works: [] });
  vi.mocked(libraryAPI.sections).mockResolvedValue({ volume: VOLUME, sections: SECTIONS });
  vi.mocked(libraryAPI.readingPositions).mockResolvedValue({ items: [] });
  vi.mocked(togetherAPI.today).mockResolvedValue({ date: DATE, count: null, is_shown: false, threshold: 10 });
});

describe("홈 · 편성 없는 날", () => {
  it("오늘의 실천은 이어 읽기 → 기도하기뿐이고 빈 날 안내·훈독하기 카드가 없다", async () => {
    const view = show(<HomeMissions today={EMPTY} />);
    await waitFor(() => expect(missionOrder(view.container)).toEqual(PRACTICE));
    expect(await screen.findByText("말씀 서고")).toHaveClass("mission__title");
    expect(screen.getByText("내 속도로")).toHaveClass("sect__meta");
    expect(screen.queryByText("오늘은 정해진 말씀이 없어요")).toBeNull();
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("href") === "/library")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /훈독하기/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /훈독하기/ })).toBeNull();
  });

  it("주인공 판: 정해진 말씀이 없다고 말하고 서고에서 고르기 · 말씀 검색으로 보낸다 — 훈독하기·책갈피 대체 없음", async () => {
    const view = show(<HomeWord today={EMPTY} serverSlot="day" />);
    expect(await screen.findByText("오늘은 정해진 말씀이 없어요")).toHaveClass("home-word__title");
    expect(screen.getByRole("link", { name: "서고에서 고르기" })).toHaveAttribute("href", "/library");
    expect(screen.getByRole("link", { name: "서고에서 고르기" })).toHaveClass("btn-primary");
    expect(screen.getByRole("link", { name: "말씀 검색" })).toHaveAttribute("href", "/search");
    expect(screen.queryByRole("link", { name: /훈독하기/ })).toBeNull();
    expect(view.container).not.toHaveTextContent(/책갈피/);
    // 말씀이 없으니 완료 칩도 없다
    expect(screen.queryByText(/^(읽기 전|읽음)$/)).toBeNull();
  });

  it("이어 읽을 기록이 있으면 실천 첫 카드가 그 자리다(A1 카드 그대로)", async () => {
    writeLastReading({ volume: VOLUME, page: 1 });
    const view = show(<HomeMissions today={EMPTY} />);
    expect(await screen.findByText("천성경 · 참사랑의 근본")).toBeInTheDocument();
    expect(missionOrder(view.container)).toEqual(PRACTICE);
    const card = view.container.querySelector(".missions > .mission .mission__link");
    expect(card).toHaveAttribute("href", `${wordsHref(VOLUME)}?page=1&from=resume`);
    // 체크는 A1 과 같이 비활성 — 빈 날에 훈독하기 완료 동선을 새로 만들지 않는다
    expect(screen.getByRole("button", { name: "말씀 읽기 · 이어 읽기 완료" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /^말씀 서고/ })).toBeNull();
  });

  it("편성이 정해지기 전에는 카드 두 장 자리만 잡고, 정해지면 같은 두 장이 그 자리에 들어간다", async () => {
    vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
    let resolveJeongseong: (value: JeongseongTodayResponse) => void = () => {};
    vi.mocked(jeongseongAPI.today).mockReturnValue(
      new Promise((resolve) => {
        resolveJeongseong = resolve;
      }),
    );
    const view = show(<HomeMissions today={EMPTY} />);
    await waitFor(() => expect(jeongseongAPI.today).toHaveBeenCalled());
    const missions = view.container.querySelector(".missions");
    expect(missions).toHaveAttribute("aria-busy", "true");
    expect(missionOrder(view.container)).toEqual(["", ""]);
    expect(screen.queryByRole("link", { name: /훈독하기/ })).toBeNull();
    resolveJeongseong({ date: DATE, status: "none", reason: null, period_id: null, reading: null });
    await waitFor(() => expect(missionOrder(view.container)).toEqual(PRACTICE));
    expect(missions).not.toHaveAttribute("aria-busy");
  });

  it("철회된 날도 빈 날과 같은 안내다", async () => {
    show(<HomeWord today={WITHDRAWN} serverSlot="day" />);
    expect(await screen.findByText("오늘은 정해진 말씀이 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "서고에서 고르기" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /훈독하기/ })).toBeNull();
  });

  it("편성 조회 실패는 빈 날이 아니다 — 원인 안내와 훈독하기(/read)만 두고 빈 날 문구·서고 버튼을 띄우지 않는다", async () => {
    show(
      <>
        <HomeWord today={FAILED} serverSlot="day" />
        <HomeMissions today={FAILED} />
      </>,
    );
    expect(await screen.findByText("오늘 편성을 불러오지 못했어요. 연결을 확인해 주세요.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: /훈독하기/ })).toHaveAttribute("href", "/read"));
    expect(screen.getByText("오늘 말씀을 확인하지 못했어요")).toBeInTheDocument();
    expect(screen.queryByText("오늘은 정해진 말씀이 없어요")).toBeNull();
    expect(screen.queryByRole("link", { name: "서고에서 고르기" })).toBeNull();
    expect(screen.queryByText(/기다리고|편성되면/)).toBeNull();
  });

  it("정성 진행자도 일반 편성이 없으면 '일반 편성을 보여드려요' 라고 하지 않는다", async () => {
    vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
    vi.mocked(jeongseongAPI.today).mockResolvedValue({
      date: DATE,
      status: "none",
      reason: "no_candidates",
      period_id: "p",
      reading: null,
    } as JeongseongTodayResponse);
    show(
      <>
        <HomeWord today={EMPTY} serverSlot="day" />
        <HomeMissions today={EMPTY} />
        <HomeWeek today={EMPTY} todayWeekday={2} />
      </>,
    );
    expect(await screen.findByText("오늘 주제에 맞는 정성 말씀을 찾지 못했어요.")).toBeInTheDocument();
    expect(screen.getByText("오늘은 정해진 말씀이 없어요")).toBeInTheDocument();
    expect(screen.queryByText(/일반 편성을 보여드려요/)).toBeNull();
    // 연속일은 그대로 보인다(S1 서버 계산)
    expect(await screen.findByText("연속 12일")).toBeInTheDocument();
  });

  it("편성 있는 날: 판이 제목·훈독하기를 갖고 실천은 같은 두 장이다", async () => {
    const view = show(
      <>
        <HomeWord today={AVAILABLE} serverSlot="day" />
        <HomeMissions today={AVAILABLE} />
      </>,
    );
    expect(await screen.findByText("일반 편성")).toHaveClass("home-word__title");
    expect(screen.getByText("3분")).toHaveClass("home-word__min");
    expect(screen.getByRole("link", { name: "훈독하기" })).toHaveAttribute("href", "/read");
    await waitFor(() => expect(missionOrder(view.container)).toEqual(PRACTICE));
    expect(screen.queryByRole("link", { name: "서고에서 고르기" })).toBeNull();
  });
});

describe("홈 · 오늘 읽을 말씀 완료 칩", () => {
  it("판정 전에는 칩이 없고, 오늘 안 읽었으면 '읽기 전', 요약이 읽음이면 '읽음'", async () => {
    vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
    let resolveSummary: (value: Awaited<ReturnType<typeof missionsAPI.summary>>) => void = () => {};
    vi.mocked(missionsAPI.summary).mockReturnValue(
      new Promise((resolve) => {
        resolveSummary = resolve;
      }),
    );
    show(<HomeWord today={AVAILABLE} serverSlot="day" />);
    expect(await screen.findByText("일반 편성")).toBeInTheDocument();
    await waitFor(() => expect(missionsAPI.summary).toHaveBeenCalled());
    expect(screen.queryByText(/^(읽기 전|읽음)$/)).toBeNull();
    resolveSummary({
      today: { read: true, pray: false, study: false },
      week: [],
      streak_days: 1,
      best_streak_days: 1,
      total_days: 1,
    });
    const chip = await screen.findByText("읽음");
    expect(chip).toHaveAttribute("data-done");
  });

  it("비로그인: 이 기기에서 오늘 마쳤으면 '읽음', 아니면 '읽기 전'", async () => {
    const first = show(<HomeWord today={AVAILABLE} serverSlot="day" />);
    expect(await screen.findByText("읽기 전")).not.toHaveAttribute("data-done");
    first.unmount();
    writePending("read");
    show(<HomeWord today={AVAILABLE} serverSlot="day" />);
    expect(await screen.findByText("읽음")).toHaveAttribute("data-done");
    expect(missionsAPI.summary).not.toHaveBeenCalled();
  });
});

describe("홈 · 함께 읽는 사람들", () => {
  it("편성 없는 날에는 익명 카드를 그리지 않고 숫자도 부르지 않는다", async () => {
    const view = show(<HomeTogether today={EMPTY} />);
    await waitFor(() => expect(identityAPI.me).toHaveBeenCalled());
    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
    expect(togetherAPI.today).not.toHaveBeenCalled();
  });

  it("편성 있는 날에는 그대로 보인다", async () => {
    show(<HomeTogether today={AVAILABLE} />);
    expect(await screen.findByRole("heading", { name: "함께 읽는 사람들" })).toBeInTheDocument();
  });

  it("비로그인 · 읽기 전이면 읽으러 가는 버튼이 있다", async () => {
    show(<HomeTogether today={AVAILABLE} />);
    expect(await screen.findByRole("link", { name: "오늘 말씀 읽으러 가기" })).toHaveAttribute("href", "/read");
    expect(screen.getByText("오늘도 식구들이 훈독하고 있어요")).toBeInTheDocument();
  });

  it("로그인 · 오늘 기록이 있으면 함께했다는 확인만 보인다", async () => {
    vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
    vi.mocked(missionsAPI.summary).mockResolvedValue({
      today: { read: true, pray: false, study: false },
      week: [],
      streak_days: 12,
      best_streak_days: 12,
      total_days: 12,
    });
    vi.mocked(togetherAPI.today).mockResolvedValue({ date: DATE, count: 24, is_shown: true, threshold: 10 });
    show(<HomeTogether today={AVAILABLE} />);
    expect(await screen.findByText("오늘 24명이 함께 훈독했어요")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "오늘 말씀 읽으러 가기" })).toBeNull();
  });

  it("비로그인 · 이 기기에서만 완료면 숫자를 본인과 엮지 않는다", async () => {
    writePending("read");
    vi.mocked(togetherAPI.today).mockResolvedValue({ date: DATE, count: 24, is_shown: true, threshold: 10 });
    show(<HomeTogether today={AVAILABLE} />);
    expect(await screen.findByText("오늘 식구들과 함께 훈독했어요")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "오늘 말씀 읽으러 가기" })).toBeNull();
  });
});

describe("훈독하기(/read) · 편성 없는 날", () => {
  it("이어 읽을 기록이 있으면 상태 카드 → 이어 읽기 → 서고 순서다", async () => {
    writeLastReading({ volume: VOLUME, page: 1 });
    const view = show(<EffectiveReading today={EMPTY} />);
    expect(await screen.findByText("천성경 · 참사랑의 근본")).toBeInTheDocument();
    expect(screen.getByText("오늘은 정해진 말씀이 없어요")).toHaveClass("empty__title");
    expect(screen.getByText("읽던 말씀을 이어 읽거나 서고에서 골라 읽어요.")).toHaveClass("empty__body");
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `${wordsHref(VOLUME)}?page=1&from=resume`,
      "/library",
    ]);
    expect(screen.getByRole("link", { name: "말씀 서고로 가기" })).toHaveClass("btn-line");
    expect(view.container.querySelector(".scripture")).toBeNull();
    expect(screen.queryByRole("button", { name: "훈독 완료" })).toBeNull();
  });

  it("기록이 없으면 주 버튼이 '말씀 서고에서 고르기' 다", async () => {
    show(<EffectiveReading today={EMPTY} />);
    const primary = await screen.findByRole("link", { name: "말씀 서고에서 고르기" });
    expect(primary).toHaveAttribute("href", "/library");
    expect(primary).toHaveClass("btn-primary");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    // 상태 카드 문구도 기록이 없다는 사실을 따른다
    expect(screen.getByText("서고에서 한 권 골라 읽어요.")).toHaveClass("empty__body");
    expect(screen.queryByText(/읽던 말씀/)).toBeNull();
    expect(screen.queryByText(/아직 없어요/)).toBeNull();
  });

  it("철회된 날은 철회를 말하고 같은 다음 행동을 준다", async () => {
    show(<EffectiveReading today={WITHDRAWN} />);
    expect(await screen.findByText("오늘 말씀이 철회됐어요")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "말씀 서고에서 고르기" })).toBeInTheDocument();
  });

  it("조회 실패면 빈 날이라고 말하지 않고 원인 안내와 서고 길만 둔다", async () => {
    show(<EffectiveReading today={FAILED} />);
    expect(await screen.findByText("오늘 편성을 불러오지 못했어요. 연결을 확인해 주세요.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "말씀 서고에서 고르기" })).toBeInTheDocument();
    expect(screen.queryByText("오늘은 정해진 말씀이 없어요")).toBeNull();
  });
});
