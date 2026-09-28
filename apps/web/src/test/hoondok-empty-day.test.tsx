// 편성 없는 날(C3 안 A): 홈은 오늘 상태 한 줄 + 이어 읽기 첫 자리, 훈독하기는 이어 읽기 → 서고. 대체 말씀은 없다.
// 이어 읽기 카드 데이터는 A1(useResumeCard) 그대로라 서고 API 만 바꿔 끼운다.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { JeongseongTodayResponse, LibraryItem, SectionItem } from "@truewords/api-client-ts/types";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/hoondok", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/hoondok/library/api", async (original) => ({
  ...(await original<object>()),
  libraryAPI: { list: vi.fn(), sections: vi.fn(), readingPositions: vi.fn() },
}));
vi.mock("@/features/identity/api", () => ({ identityAPI: { me: vi.fn() } }));
vi.mock("@/features/hoondok/missions-api", () => ({ missionsAPI: { summary: vi.fn(), complete: vi.fn() } }));
vi.mock("@/features/hoondok/jeongseong-api", () => ({ jeongseongAPI: { today: vi.fn() } }));
vi.mock("@/features/hoondok/together/api", () => ({ togetherAPI: { today: vi.fn() } }));

import { HomeMissions, HomeTogether } from "@/features/hoondok/components/home-missions";
import { EffectiveReading } from "@/features/hoondok/jeongseong/components/effective-reading";
import { jeongseongAPI } from "@/features/hoondok/jeongseong-api";
import { libraryAPI, wordsHref } from "@/features/hoondok/library/api";
import { writeLastReading } from "@/features/hoondok/library/last-reading";
import { missionsAPI } from "@/features/hoondok/missions-api";
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
/** 미션 목록의 줄 순서 — 안내 줄은 "안내", 카드는 종류 이름 */
function missionOrder(container: HTMLElement) {
  return [...container.querySelectorAll(".missions > *")].map((node) =>
    node.classList.contains("day-quiet") ? "안내" : (node.querySelector(".mission__kind")?.textContent ?? ""),
  );
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
  it("기록 없음: 오늘 상태 한 줄 뒤 첫 카드가 서고이고 기다림·중복 서고 버튼·죽은 훈독하기 카드가 없다", async () => {
    const view = show(<HomeMissions today={EMPTY} todayWeekday={2} />);
    const line = await screen.findByText("오늘은 정해진 말씀이 없어요");
    expect(line.closest("[role=status]")).toHaveTextContent("서고에서 한 권 골라 읽어 보세요.");
    expect(screen.getByText("오늘은 서고에서")).toHaveClass("sect__meta");
    expect(missionOrder(view.container)).toEqual(["안내", "말씀 읽기 · 이어 읽기", "기도하기 · 1분 · 준비 중"]);
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("href") === "/hoondok/library")).toHaveLength(
      1,
    );
    expect(screen.queryByText(/기다리고|편성되면|오늘 말씀 대신/)).toBeNull();
    expect(screen.queryByRole("link", { name: /훈독하기/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /훈독하기/ })).toBeNull();
  });

  it("이어 읽을 기록이 있으면 그 자리가 첫 카드다(A1 카드 그대로)", async () => {
    writeLastReading({ volume: VOLUME, page: 1 });
    const view = show(<HomeMissions today={EMPTY} todayWeekday={2} />);
    expect(await screen.findByText("천성경 · 참사랑의 근본")).toBeInTheDocument();
    expect(screen.getByText("읽던 말씀을 이어서 읽어 보세요.")).toBeInTheDocument();
    expect(screen.getByText("오늘은 이어 읽기")).toHaveClass("sect__meta");
    expect(missionOrder(view.container)[1]).toBe("말씀 읽기 · 이어 읽기");
    const card = view.container.querySelector(".missions > .mission .mission__link");
    expect(card).toHaveAttribute("href", `${wordsHref(VOLUME)}?page=1&from=resume`);
    // 체크는 A1 과 같이 비활성 — 빈 날에 훈독하기 완료 동선을 새로 만들지 않는다
    expect(screen.getByRole("button", { name: "말씀 읽기 · 이어 읽기 완료" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /^말씀 서고/ })).toBeNull();
  });

  it("철회된 날도 빈 날과 같은 안내다", async () => {
    show(<HomeMissions today={WITHDRAWN} todayWeekday={2} />);
    expect(await screen.findByText("오늘은 정해진 말씀이 없어요")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /훈독하기/ })).toBeNull();
  });

  it("편성 조회 실패는 빈 날이 아니다 — 원인 안내만 하고 오늘 상태 한 줄을 띄우지 않는다", async () => {
    const view = show(<HomeMissions today={FAILED} todayWeekday={2} />);
    expect(await screen.findByText("오늘 편성을 불러오지 못했어요. 연결을 확인해 주세요.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /훈독하기/ })).toHaveAttribute("href", "/hoondok/read"),
    );
    expect(view.container.querySelector(".day-quiet")).toBeNull();
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
    show(<HomeMissions today={EMPTY} todayWeekday={2} />);
    expect(await screen.findByText("오늘 주제에 맞는 정성 말씀을 찾지 못했어요.")).toBeInTheDocument();
    expect(screen.getByText("오늘은 정해진 말씀이 없어요")).toBeInTheDocument();
    expect(screen.queryByText(/일반 편성을 보여드려요/)).toBeNull();
    // 연속일은 그대로 보인다(S1 서버 계산)
    expect(await screen.findByText("연속 12일")).toBeInTheDocument();
  });

  it("편성 있는 날은 지금 순서 그대로다(회귀)", async () => {
    const view = show(<HomeMissions today={AVAILABLE} todayWeekday={2} />);
    await waitFor(() =>
      expect(missionOrder(view.container)).toEqual([
        "훈독하기 · 3분",
        "기도하기 · 1분 · 준비 중",
        "말씀 읽기 · 이어 읽기",
      ]),
    );
    expect(screen.getByText("일반 편성")).toHaveClass("mission__title");
    expect(screen.getByText("2가지 · 내 속도로")).toBeInTheDocument();
    expect(view.container.querySelector(".day-quiet")).toBeNull();
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
});

describe("훈독하기(/read) · 편성 없는 날", () => {
  it("이어 읽을 기록이 있으면 상태 카드 → 이어 읽기 → 서고 순서다", async () => {
    writeLastReading({ volume: VOLUME, page: 1 });
    const view = show(<EffectiveReading today={EMPTY} />);
    expect(await screen.findByText("천성경 · 참사랑의 근본")).toBeInTheDocument();
    expect(screen.getByText("오늘은 정해진 말씀이 없어요")).toHaveClass("empty__title");
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `${wordsHref(VOLUME)}?page=1&from=resume`,
      "/hoondok/library",
    ]);
    expect(screen.getByRole("link", { name: "말씀 서고로 가기" })).toHaveClass("btn-line");
    expect(view.container.querySelector(".scripture")).toBeNull();
    expect(screen.queryByRole("button", { name: "훈독 완료" })).toBeNull();
  });

  it("기록이 없으면 주 버튼이 '말씀 서고에서 고르기' 다", async () => {
    show(<EffectiveReading today={EMPTY} />);
    const primary = await screen.findByRole("link", { name: "말씀 서고에서 고르기" });
    expect(primary).toHaveAttribute("href", "/hoondok/library");
    expect(primary).toHaveClass("btn-primary");
    expect(screen.getAllByRole("link")).toHaveLength(1);
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
