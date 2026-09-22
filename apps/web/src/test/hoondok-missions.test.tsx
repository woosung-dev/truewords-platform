import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/hoondok/read",
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
vi.mock("@/features/hoondok/missions-api", () => ({
  missionsAPI: { complete: vi.fn(), summary: vi.fn() },
}));

import { HomeGreeting } from "@/features/hoondok/components/home-missions";
import { ReadCompleteButton } from "@/features/hoondok/components/read-complete-button";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { clearPending, readPending, writePending } from "@/features/hoondok/pending";
import { formatKstDate } from "@/features/hoondok/today";
import { useMissionCompletion } from "@/features/hoondok/use-missions";
import { identityAPI } from "@/features/identity/api";
import { CURRENT_USER_KEY } from "@/features/identity/use-current-user";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const TODAY = formatKstDate().iso;
const KEY = "hoondok:pending:read";
const ASK_HREF = "/hoondok/ask?q=%EB%A7%90%EC%94%80";
const EMPTY_SUMMARY = {
  today: { read: false, pray: false, study: false },
  streak_days: 0,
  best_streak_days: 0,
  total_days: 0,
  week: [],
};

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function loggedOut() {
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "x" }));
}
function loggedIn() {
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
  vi.mocked(missionsAPI.summary).mockResolvedValue(EMPTY_SUMMARY);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("pending (비로그인 완료 체크, KST 날짜 키)", () => {
  it("오늘 키만 유효하고 어제 키(자정 경과)는 버린다", () => {
    writePending("read", "2026-09-16");
    expect(readPending("read", "2026-09-17")).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    writePending("read", "2026-09-17");
    expect(readPending("read", "2026-09-17")).toBe(true);
    clearPending("read");
    expect(readPending("read", "2026-09-17")).toBe(false);
  });

  it("로그인 실패 완료는 해당 계정에만 보이고 지연된 전날 응답은 새 날짜 키를 지우지 않는다", () => {
    writePending("study", TODAY, "one");
    expect(readPending("study", TODAY, "two")).toBe(false);
    expect(readPending("study", TODAY, "one")).toBe(true);
    clearPending("study", "2000-01-01", "one");
    expect(readPending("study", TODAY, "one")).toBe(true);
    clearPending("study", TODAY, "one");
    expect(readPending("study", TODAY, "one")).toBe(false);
  });

  it("localStorage 가 던져도 예외 없이 '없음' 으로 본다", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPending("read", TODAY)).toBe(false);
    expect(() => writePending("read", TODAY)).not.toThrow();
    spy.mockRestore();
  });
});

describe("ReadCompleteButton", () => {
  it("비로그인: 로컬 완료 + 오늘 키 저장 + 로그인 링크, API 호출 없음", async () => {
    loggedOut();
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    expect(await screen.findByText("완료 기록은 로그인 후 남아요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /훈독 완료/ }));
    expect(screen.getByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    expect(screen.getByRole("link", { name: /로그인하면 오늘 기록이 남아요/ })).toHaveAttribute(
      "href",
      "/hoondok/onboarding?returnTo=%2Fhoondok%2Fread",
    );
    expect(localStorage.getItem(KEY)).toBe(TODAY);
    expect(missionsAPI.complete).not.toHaveBeenCalled();
  });

  it("로그인 + 409(하루 1회): 완료로 보고 오류를 내지 않는다", async () => {
    loggedIn();
    vi.mocked(missionsAPI.complete).mockRejectedValueOnce(new ApiError(409, { message: "오늘은 이미 완료했어요" }));
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    const button = await screen.findByRole("button", { name: /훈독 완료/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    expect(screen.queryByText(/저장하지 못했어요/)).toBeNull();
    expect(missionsAPI.complete).toHaveBeenCalledWith("read");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("로그인 + 오프라인: 로컬 완료 유지 + 안내 + 소급 키 보존", async () => {
    loggedIn();
    vi.mocked(missionsAPI.complete).mockRejectedValueOnce(new TypeError("fetch failed"));
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    await waitFor(() => expect(screen.getByRole("button", { name: /훈독 완료/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /훈독 완료/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    expect(screen.getByText(/아직 저장하지 못했어요/)).toBeInTheDocument();
    expect(localStorage.getItem(`${KEY}:${USER.id}`)).toBe(TODAY);
  });

  it("로그인 + 401(쿠키 만료): 온보딩(returnTo=현재 경로)으로 보낸다", async () => {
    loggedIn();
    vi.mocked(missionsAPI.complete).mockRejectedValueOnce(new ApiError(401, { message: "x" }));
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    await waitFor(() => expect(screen.getByRole("button", { name: /훈독 완료/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /훈독 완료/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/hoondok/onboarding?returnTo=%2Fhoondok%2Fread"));
  });

  it("소급: 로그인 상태에서 오늘 키가 있으면 한 번만 POST 하고 키를 지운다", async () => {
    loggedIn();
    writePending("read", TODAY);
    vi.mocked(missionsAPI.complete).mockResolvedValueOnce({ mission_date: TODAY, kind: "read", completed_at: "x" });
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    await waitFor(() => expect(missionsAPI.complete).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
  });

  it("자정 경계: 어제 키는 소급하지 않고 버린다", async () => {
    loggedIn();
    localStorage.setItem(KEY, "2000-01-01");
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    await screen.findByRole("button", { name: /훈독 완료/ });
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(missionsAPI.complete).not.toHaveBeenCalled();
  });

  it("보조 동선(질문하기)은 주 CTA 와 경쟁하지 않는 글자 링크다", async () => {
    loggedOut();
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    const link = await screen.findByRole("link", { name: "이 말씀에 질문하기" });
    expect(link).toHaveAttribute("href", ASK_HREF);
    expect(link).toHaveClass("read-ask-link");
    // 전폭 .btn 두 개가 쌓이면 화면의 시선 종착점이 둘로 갈린다 (DES §3.1 · §5)
    expect(link.className.split(/\s+/)).not.toContain("btn");
    // 완료해도 같은 줄에 남는다
    fireEvent.click(screen.getByRole("button", { name: /훈독 완료/ }));
    expect(screen.getByRole("link", { name: "이 말씀에 질문하기" })).toBeInTheDocument();
  });

  it("연속일은 요약이 온 뒤에만 적는다 (도착 전 0 을 보이지 않는다)", async () => {
    loggedIn();
    vi.mocked(missionsAPI.summary).mockResolvedValue({ ...EMPTY_SUMMARY, streak_days: 12 });
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    expect(screen.queryByText(/연속/)).toBeNull();
    expect(await screen.findByText("완료하면 연속 13일이 돼요")).toBeInTheDocument();
  });

  it("낙관적 완료 직후에는 연속일을 단정하지 않는다 — 서버가 오늘 완료를 확정해야 쓴다", async () => {
    loggedIn();
    // 요약은 아직 어제까지의 사실이다(오늘 미완료 · 연속 0일). 완료 POST 는 성공해도 재조회가 닿기 전이라
    // 이 순간의 streak_days 로 "연속 0일째" 를 말하면 거짓이다.
    vi.mocked(missionsAPI.summary).mockResolvedValue({ ...EMPTY_SUMMARY, streak_days: 0 });
    vi.mocked(missionsAPI.complete).mockResolvedValue({ mission_date: TODAY, kind: "read", completed_at: "x" });
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    expect(await screen.findByText("완료하면 연속 1일이 돼요")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /훈독 완료/ }));

    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    expect(screen.queryByText(/연속 0일째/)).toBeNull();
    expect(screen.queryByText(/이어가고 있어요/)).toBeNull();
  });

  it("저장 실패(로컬만 완료)면 연속일 문구로 실패 안내와 어긋나지 않는다", async () => {
    loggedIn();
    vi.mocked(missionsAPI.summary).mockResolvedValue({ ...EMPTY_SUMMARY, streak_days: 7 });
    vi.mocked(missionsAPI.complete).mockRejectedValueOnce(new TypeError("fetch failed"));
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    await waitFor(() => expect(screen.getByRole("button", { name: /훈독 완료/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /훈독 완료/ }));

    expect(await screen.findByText(/아직 저장하지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByText(/이어가고 있어요/)).toBeNull();
  });

  it("서버가 오늘 완료를 확정하면 연속일을 적는다", async () => {
    loggedIn();
    vi.mocked(missionsAPI.summary).mockResolvedValue({
      ...EMPTY_SUMMARY,
      today: { read: true, pray: false, study: false },
      streak_days: 13,
    });
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    expect(await screen.findByText("연속 13일째 이어가고 있어요")).toBeInTheDocument();
  });

  it("저장 중에는 라벨을 유지한 채 스피너를 돌리고 중복 제출을 막는다 (DES §1.5 loading)", async () => {
    loggedIn();
    vi.mocked(missionsAPI.complete).mockReturnValue(new Promise<never>(() => {}));
    const { container } = render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    const button = await screen.findByRole("button", { name: /훈독 완료/ });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("훈독 완료");
    expect(container.querySelector(".btn__spinner")).not.toBeNull();
    fireEvent.click(button);
    expect(missionsAPI.complete).toHaveBeenCalledTimes(1);
  });

  it("summary 가 오늘 완료라면 처음부터 완료 상태다", async () => {
    loggedIn();
    vi.mocked(missionsAPI.summary).mockResolvedValue({
      ...EMPTY_SUMMARY,
      today: { read: true, pray: false, study: false },
    });
    render(wrap(<ReadCompleteButton askHref={ASK_HREF} />));
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
  });
});

describe("완료 상태의 계정·날짜 경계", () => {
  it("같은 컴포넌트에서 사용자가 바뀌면 앞 계정의 낙관적 완료를 재사용하지 않는다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CURRENT_USER_KEY, USER);
    vi.mocked(missionsAPI.complete).mockResolvedValue({ mission_date: TODAY, kind: "study", completed_at: "x" });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(({ id }) => useMissionCompletion("study", { ...USER, id }, false), {
      wrapper,
      initialProps: { id: USER.id },
    });
    act(() => result.current.markDone());
    await waitFor(() => expect(result.current.isDone).toBe(true));
    act(() => {
      client.setQueryData(CURRENT_USER_KEY, { ...USER, id: "other" });
      rerender({ id: "other" });
    });
    await waitFor(() => expect(result.current.isDone).toBe(false));
  });
});

// 2026-09-22 DES-PWA-003-Q2 되돌림 — 히어로가 다시 사진이다. 사진은 레포 정적 파일이어야 하고
// (외부 hotlink 금지) 로그인 전 인사에 없는 이름이 들어가면 안 된다.
describe("HomeGreeting 사진 히어로", () => {
  it("레포 정적 사진을 싣고 로그인 전에는 이름 없이 인사한다", async () => {
    loggedOut();
    render(wrap(<HomeGreeting />));
    const photo = await screen.findByAltText("아침 햇살이 드는 들판");
    expect(photo.getAttribute("src")).toMatch(/^\/hoondok\/photos\//);
    expect(screen.getByText(/오늘도 함께 읽어요/)).toBeInTheDocument();
    expect(screen.queryByText(/효진님/)).toBeNull();
  });

  it("로그인하면 같은 문장 안에 이름이 들어간다", async () => {
    loggedIn();
    render(wrap(<HomeGreeting />));
    expect(await screen.findByText(/효진님, 오늘도 함께 읽어요/)).toBeInTheDocument();
  });
});
