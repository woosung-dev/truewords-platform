import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { JeongseongTodayResponse } from "@truewords/api-client-ts/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeMissions } from "@/features/hoondok/components/home-missions";
import { EffectiveReading } from "@/features/hoondok/jeongseong/components/effective-reading";
import { useEffectiveToday } from "@/features/hoondok/jeongseong/use-effective-today";
import { jeongseongAPI } from "@/features/hoondok/jeongseong-api";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { JEONGSEONG_TODAY_KEY, PROGRESS_KEYS } from "@/features/hoondok/query-keys";
import { formatKstDate, type TodayResponse } from "@/features/hoondok/today";
import { useKstDate } from "@/features/hoondok/use-kst-date";
import { CURRENT_USER_KEY } from "@/features/identity/use-current-user";

vi.mock("next/navigation", () => ({ usePathname: () => "/hoondok", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/hoondok/jeongseong-api", () => ({ jeongseongAPI: { today: vi.fn() } }));
vi.mock("@/features/hoondok/missions-api", () => ({ missionsAPI: { summary: vi.fn(), complete: vi.fn() } }));

const DATE = formatKstDate().iso;
const PUBLIC: TodayResponse = {
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
};
const PERSONAL: JeongseongTodayResponse = {
  date: DATE,
  status: "available",
  reason: null,
  period_id: "period",
  reading: {
    ...PUBLIC.reading!,
    id: "personal",
    title: "오늘 정성 말씀",
    body: "맞춤 원문",
    review_status: "unverified",
  },
};
const USER = { id: "one", display_name: "사용자", email: "one@example.com" };
function setup(user: typeof USER | null = USER) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(CURRENT_USER_KEY, user);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(jeongseongAPI.today).mockResolvedValue(PERSONAL);
  vi.mocked(missionsAPI.summary).mockResolvedValue({
    today: { read: false, study: false, pray: false },
    week: [],
    streak_days: 0,
    best_streak_days: 0,
    total_days: 0,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("홈·읽기 공통 오늘 말씀", () => {
  it("개인화가 확인되기 전 홈에서 다른 편성을 완료하지 못하고 두 화면은 같은 말씀을 쓴다", async () => {
    let resolve!: (value: JeongseongTodayResponse) => void;
    vi.mocked(jeongseongAPI.today).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { wrapper } = setup();
    render(
      <>
        <HomeMissions today={PUBLIC} todayWeekday={1} />
        <EffectiveReading today={PUBLIC} />
      </>,
      { wrapper },
    );
    expect(screen.getByRole("button", { name: /훈독하기.*완료/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "훈독 완료" })).toBeNull();
    await act(async () => resolve(PERSONAL));
    expect(await screen.findByRole("heading", { name: "오늘 정성 말씀" })).toBeInTheDocument();
    expect(screen.getAllByText("오늘 정성 말씀")).toHaveLength(2);
    expect(jeongseongAPI.today).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /말씀 읽기/ })).toHaveAttribute("href", "/hoondok/library");
    expect(screen.getByRole("button", { name: /말씀 읽기.*완료/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /훈독하기.*완료/ }));
    await waitFor(() => expect(missionsAPI.complete).toHaveBeenCalledWith("read"));
    expect(jeongseongAPI.today).toHaveBeenCalledTimes(1);
  });
  it("이번 주 메타는 요약이 도착한 뒤에만 연속일을 표시한다", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof missionsAPI.summary>>) => void;
    vi.mocked(missionsAPI.summary).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { wrapper } = setup();
    const view = render(<HomeMissions today={PUBLIC} todayWeekday={1} />, { wrapper });
    expect(view.container.querySelector(".week__streak")).toBeNull();
    expect(screen.queryByText("연속 3일")).toBeNull();
    await act(async () =>
      resolve({
        today: { read: true, study: false, pray: false },
        week: [],
        streak_days: 3,
        best_streak_days: 3,
        total_days: 3,
      }),
    );
    expect(await screen.findByText("연속 3일")).toHaveClass("sect__meta");
    expect(view.container.querySelector(".week__streak")).toHaveTextContent("연속 3일");
  });
  it.each(["no_candidates", "rights_withdrawn", "upcoming"] as const)(
    "%s 는 이유를 알리고 일반 편성으로 돌아간다",
    async (reason) => {
      vi.mocked(jeongseongAPI.today).mockResolvedValue({
        date: DATE,
        status: "none",
        reason,
        period_id: "period",
        reading: null,
      });
      const { wrapper } = setup();
      const { result } = renderHook(() => useEffectiveToday(PUBLIC), { wrapper });
      await waitFor(() => expect(result.current.isResolving).toBe(false));
      expect(result.current.reading?.title).toBe("일반 편성");
      expect(result.current.reason).toMatch(/일반 편성/);
    },
  );
  it("조회 실패는 기존 편성 폴백의 이유를 알린다", async () => {
    vi.mocked(jeongseongAPI.today).mockRejectedValue(new Error("offline"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useEffectiveToday(PUBLIC), { wrapper });
    await waitFor(() => expect(result.current.reason).toMatch(/확인하지 못해/));
    expect(result.current.reading?.id).toBe("regular");
  });
  it("완료 무효화는 정성 진행률만 다시 읽고 당일 선택을 재생성하지 않는다", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useEffectiveToday(PUBLIC), { wrapper });
    await waitFor(() => expect(result.current.reading?.id).toBe("personal"));
    await act(async () => {
      await Promise.all(PROGRESS_KEYS.map((queryKey) => client.invalidateQueries({ queryKey })));
    });
    expect(jeongseongAPI.today).toHaveBeenCalledTimes(1);
    expect(client.getQueryData([...JEONGSEONG_TODAY_KEY, USER.id, DATE])).toEqual(PERSONAL);
  });
  it("로그아웃·계정 전환 때 이전 사용자의 말씀을 보이지 않는다", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useEffectiveToday(PUBLIC), { wrapper });
    await waitFor(() => expect(result.current.reading?.id).toBe("personal"));
    act(() => client.setQueryData(CURRENT_USER_KEY, null));
    await waitFor(() => expect(result.current.reading?.id).toBe("regular"));
    vi.mocked(jeongseongAPI.today).mockResolvedValue({
      ...PERSONAL,
      reading: { ...PERSONAL.reading!, id: "second", title: "두번째 사용자 말씀" },
    });
    act(() => client.setQueryData(CURRENT_USER_KEY, { ...USER, id: "two" }));
    await waitFor(() => expect(result.current.reading?.id).toBe("second"));
  });
  it("열린 화면은 KST 자정에 날짜 키를 바꾼다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T14:59:59.900Z"));
    const { result } = renderHook(() => useKstDate());
    expect(result.current).toBe("2026-09-21");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(101);
    });
    expect(result.current).toBe("2026-09-22");
  });
  it("비로그인에는 개인화 API 를 요청하지 않는다", () => {
    const { wrapper } = setup(null);
    const { result } = renderHook(() => useEffectiveToday(PUBLIC), { wrapper });
    expect(result.current.reading?.id).toBe("regular");
    expect(jeongseongAPI.today).not.toHaveBeenCalled();
  });
});
