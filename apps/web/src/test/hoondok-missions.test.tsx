import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { ReadCompleteButton } from "@/features/hoondok/components/read-complete-button";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { clearPending, readPending, writePending } from "@/features/hoondok/pending";
import { formatKstDate } from "@/features/hoondok/today";
import { identityAPI } from "@/features/identity/api";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const TODAY = formatKstDate().iso;
const KEY = "hoondok:pending:read";
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
    render(wrap(<ReadCompleteButton />));
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
    render(wrap(<ReadCompleteButton />));
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
    render(wrap(<ReadCompleteButton />));
    fireEvent.click(await screen.findByRole("button", { name: /훈독 완료/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    expect(screen.getByText(/아직 저장하지 못했어요/)).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(TODAY);
  });

  it("로그인 + 401(쿠키 만료): 온보딩(returnTo=현재 경로)으로 보낸다", async () => {
    loggedIn();
    vi.mocked(missionsAPI.complete).mockRejectedValueOnce(new ApiError(401, { message: "x" }));
    render(wrap(<ReadCompleteButton />));
    fireEvent.click(await screen.findByRole("button", { name: /훈독 완료/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/hoondok/onboarding?returnTo=%2Fhoondok%2Fread"));
  });

  it("소급: 로그인 상태에서 오늘 키가 있으면 한 번만 POST 하고 키를 지운다", async () => {
    loggedIn();
    writePending("read", TODAY);
    vi.mocked(missionsAPI.complete).mockResolvedValueOnce({ mission_date: TODAY, kind: "read", completed_at: "x" });
    render(wrap(<ReadCompleteButton />));
    await waitFor(() => expect(missionsAPI.complete).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
  });

  it("자정 경계: 어제 키는 소급하지 않고 버린다", async () => {
    loggedIn();
    localStorage.setItem(KEY, "2000-01-01");
    render(wrap(<ReadCompleteButton />));
    await screen.findByRole("button", { name: /훈독 완료/ });
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(missionsAPI.complete).not.toHaveBeenCalled();
  });

  it("summary 가 오늘 완료라면 처음부터 완료 상태다", async () => {
    loggedIn();
    vi.mocked(missionsAPI.summary).mockResolvedValue({
      ...EMPTY_SUMMARY,
      today: { read: true, pray: false, study: false },
    });
    render(wrap(<ReadCompleteButton />));
    expect(await screen.findByRole("status")).toHaveTextContent("오늘 훈독을 마쳤어요");
  });
});
