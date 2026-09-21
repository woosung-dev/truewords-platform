import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { historyAPI, type MonthHistoryResponse } from "@/features/hoondok/history-api";
import { type JeongseongPeriodResponse, jeongseongAPI } from "@/features/hoondok/jeongseong-api";
import { kstMonthKey, monthGrid } from "@/features/hoondok/kst";
import { HISTORY_KEY, historyKey, JEONGSEONG_KEY, SUMMARY_KEY } from "@/features/hoondok/query-keys";
import { useMonthHistory } from "@/features/hoondok/use-history";
import {
  createErrorMessage,
  UNAUTHORIZED,
  useAbandonJeongseong,
  useCreateJeongseong,
  useJeongseong,
} from "@/features/hoondok/use-jeongseong";
import type { HoondokUser } from "@/features/identity/types";
import { CURRENT_USER_KEY } from "@/features/identity/use-current-user";
import { useDeleteMe } from "@/features/identity/use-delete-me";

// API 모듈을 mock 하지 않고 fetch 만 바꿔 끼운다 — createApiClient 의 헤더·204·오류 변환까지 함께 검증한다.
const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const noContent = () => new Response(null, { status: 204 });

/** 마지막 fetch 호출의 URL·init·헤더 */
function lastCall() {
  const [input, init] = fetchMock.mock.calls.at(-1) ?? [];
  return {
    url: String(input instanceof Request ? input.url : input),
    init: init ?? {},
    headers: new Headers(init?.headers),
  };
}

const USER: HoondokUser = { id: "u1", email: "a@b.c", display_name: "효진" };
const PERIOD: JeongseongPeriodResponse = {
  id: "p1",
  topic: "감사",
  duration_days: 21,
  started_on: "2026-09-19",
  reminder_time: null,
  status: "active",
  progress: { end_on: "2026-10-09", done_days: 1, missed_days: 0, remaining_days: 20, percent: 5, state: "active" },
};
const HISTORY: MonthHistoryResponse = {
  month: "2026-09",
  days: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    done: i === 0,
  })),
};

function createClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(CURRENT_USER_KEY, USER);
  return client;
}
function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("jeongseongAPI (API-HD-009)", () => {
  it("create: POST JSON 본문 + X-Requested-With + 쿠키 포함, 201 본문을 돌려준다", async () => {
    fetchMock.mockResolvedValueOnce(json(PERIOD, 201));
    const result = await jeongseongAPI.create({ topic: "감사", duration_days: 21 });
    const { url, init, headers } = lastCall();
    expect(url).toBe("/api/backend/hoondok/me/jeongseong");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ topic: "감사", duration_days: 21 }));
    expect(headers.get("X-Requested-With")).toBe("XMLHttpRequest");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(result).toEqual(PERIOD);
  });

  it("abandon: DELETE 204 → undefined, 404 는 ApiError 로 남는다", async () => {
    fetchMock.mockResolvedValueOnce(noContent());
    await expect(jeongseongAPI.abandon()).resolves.toBeUndefined();
    const { url, init, headers } = lastCall();
    expect(url).toBe("/api/backend/hoondok/me/jeongseong");
    expect(init.method).toBe("DELETE");
    expect(headers.get("X-Requested-With")).toBe("XMLHttpRequest");

    fetchMock.mockResolvedValueOnce(json({ message: "진행 중인 정성 기간이 없어요" }, 404));
    await expect(jeongseongAPI.abandon()).rejects.toMatchObject({ status: 404 });
  });
});

describe("useJeongseong", () => {
  async function renderJeongseong(response: Response) {
    const client = createClient();
    fetchMock.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useJeongseong(true), { wrapper: createWrapper(client) });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    return { result: result.current, client };
  }

  it("401 → null (오류 아님), {period:null} → null, period 있으면 그대로", async () => {
    const unauthorized = await renderJeongseong(json({ message: "로그인이 필요합니다" }, 401));
    expect(unauthorized.result.isSuccess).toBe(true);
    expect(unauthorized.result.data).toBeNull();
    expect(unauthorized.client.getQueriesData({ queryKey: JEONGSEONG_KEY })[0]?.[1]).toBeNull();

    const none = await renderJeongseong(json({ period: null }));
    expect(none.result.data).toBeNull();

    const active = await renderJeongseong(json({ period: PERIOD }));
    expect(active.result.data).toEqual(PERIOD);
  });

  it("5xx·네트워크 단절은 error 로 남긴다 (오프라인 ≠ 정성 없음)", async () => {
    const down = await renderJeongseong(json({ message: "down" }, 503));
    expect(down.result.isError).toBe(true);
    expect(down.result.error).toBeInstanceOf(ApiError);

    const client = createClient();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const { result } = renderHook(() => useJeongseong(true), { wrapper: createWrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(TypeError);
  });

  it("isEnabled=false 면 요청하지 않는다", () => {
    renderHook(() => useJeongseong(false), { wrapper: createWrapper(createClient()) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createErrorMessage", () => {
  it("401 신호 · 409 · 422 · 그 외(5xx·네트워크·미지 값) 를 분류한다", () => {
    expect(UNAUTHORIZED).toBe("unauthorized");
    expect(createErrorMessage(new ApiError(401, { message: "x" }))).toBe(UNAUTHORIZED);
    expect(createErrorMessage(new ApiError(409, { message: "서버 문구" }))).toBe("이미 진행 중인 정성이 있어요");
    expect(createErrorMessage(new ApiError(422, { message: "x" }))).toBe("입력값을 확인해 주세요");
    const fallback = "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요";
    expect(createErrorMessage(new ApiError(503, { message: "x" }))).toBe(fallback);
    expect(createErrorMessage(new ApiError(403, { message: "CSRF" }))).toBe(fallback);
    expect(createErrorMessage(new TypeError("fetch failed"))).toBe(fallback);
    expect(createErrorMessage(undefined)).toBe(fallback);
  });
});

describe("useCreateJeongseong", () => {
  it("성공 시 JEONGSEONG_KEY·SUMMARY_KEY 를 무효화한다 (다른 키는 그대로)", async () => {
    const client = createClient();
    client.setQueryData(JEONGSEONG_KEY, null);
    client.setQueryData(SUMMARY_KEY, { streak_days: 0 });
    client.setQueryData(CURRENT_USER_KEY, USER);
    fetchMock.mockResolvedValueOnce(json(PERIOD, 201));

    const { result } = renderHook(() => useCreateJeongseong(), { wrapper: createWrapper(client) });
    result.current.mutate({ topic: "감사", duration_days: 21 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(PERIOD);
    expect(client.getQueryState(JEONGSEONG_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState(SUMMARY_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState(CURRENT_USER_KEY)?.isInvalidated).toBe(false);
  });

  it("409 는 error 로 남고 createErrorMessage 가 기존 정성 안내를 준다", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "이미 진행 중인 정성 기간이 있어요" }, 409));
    const { result } = renderHook(() => useCreateJeongseong(), { wrapper: createWrapper(createClient()) });
    result.current.mutate({ topic: "감사", duration_days: 7 });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(createErrorMessage(result.current.error)).toBe("이미 진행 중인 정성이 있어요");
  });
});

describe("useAbandonJeongseong", () => {
  it("204 와 404(이미 없음) 모두 성공으로 보고 두 키를 무효화한다", async () => {
    for (const response of [noContent(), json({ message: "없음" }, 404)]) {
      const client = createClient();
      client.setQueryData(JEONGSEONG_KEY, PERIOD);
      client.setQueryData(SUMMARY_KEY, { streak_days: 1 });
      fetchMock.mockResolvedValueOnce(response);

      const { result } = renderHook(() => useAbandonJeongseong(), { wrapper: createWrapper(client) });
      result.current.mutate();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(client.getQueryState(JEONGSEONG_KEY)?.isInvalidated).toBe(true);
      expect(client.getQueryState(SUMMARY_KEY)?.isInvalidated).toBe(true);
    }
  });

  it("403(CSRF)·5xx 는 error 로 남긴다", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "CSRF" }, 403));
    const { result } = renderHook(() => useAbandonJeongseong(), { wrapper: createWrapper(createClient()) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 403 });
  });
});

describe("historyAPI (API-HD-010)", () => {
  it("month 가 있으면 ?month= 쿼리, 없으면 서버 기본(오늘 KST 의 월). GET 엔 XHR 헤더 없음", async () => {
    fetchMock.mockResolvedValueOnce(json(HISTORY));
    expect(await historyAPI.month("2026-09")).toEqual(HISTORY);
    expect(lastCall().url).toBe("/api/backend/hoondok/me/history?month=2026-09");
    expect(lastCall().headers.get("X-Requested-With")).toBeNull();

    fetchMock.mockResolvedValueOnce(json(HISTORY));
    await historyAPI.month();
    expect(lastCall().url).toBe("/api/backend/hoondok/me/history");
  });
});

describe("useMonthHistory", () => {
  async function renderHistory(response: Response) {
    const client = createClient();
    fetchMock.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useMonthHistory("2026-09", true), { wrapper: createWrapper(client) });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    return { result: result.current, client };
  }

  it("historyKey(month) 로 캐시하고 401 → null, 5xx → error", async () => {
    const ok = await renderHistory(json(HISTORY));
    expect(ok.result.data).toEqual(HISTORY);
    expect(ok.client.getQueriesData({ queryKey: historyKey("2026-09") })[0]?.[1]).toEqual(HISTORY);
    // 접두 키 자체에는 데이터가 없다 — 접두 무효화(PROGRESS_KEYS)만 잡히면 된다
    expect(ok.client.getQueryData(HISTORY_KEY)).toBeUndefined();

    const unauthorized = await renderHistory(json({ message: "x" }, 401));
    expect(unauthorized.result.isSuccess).toBe(true);
    expect(unauthorized.result.data).toBeNull();

    const down = await renderHistory(json({ message: "x" }, 500));
    expect(down.result.isError).toBe(true);
  });
});

describe("kst", () => {
  it("kstMonthKey: UTC 23:30 은 KST 다음날 — 월·연 경계도 KST 로 넘어간다", () => {
    expect(kstMonthKey(new Date("2026-08-31T15:30:00Z"))).toBe("2026-09");
    expect(kstMonthKey(new Date("2026-08-31T14:59:59Z"))).toBe("2026-08");
    expect(kstMonthKey(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01");
  });

  it("monthGrid: 월요일 시작 — 9/1 화요일은 빈 칸 1, 6/1 월요일 0, 11/1 일요일 6", () => {
    expect(monthGrid("2026-09", HISTORY.days)).toEqual({ leadingBlanks: 1, cells: HISTORY.days });
    expect(monthGrid("2026-06", []).leadingBlanks).toBe(0);
    expect(monthGrid("2026-11", []).leadingBlanks).toBe(6);
  });
});

describe("useDeleteMe (API-HD-011)", () => {
  it("DELETE 204 → me 캐시 null · hoondok 캐시 제거 · hoondok:* 로컬 키 제거(다른 키 보존)", async () => {
    const client = createClient();
    client.setQueryData(CURRENT_USER_KEY, USER);
    client.setQueryData(SUMMARY_KEY, { streak_days: 3 });
    client.setQueryData(JEONGSEONG_KEY, PERIOD);
    client.setQueryData(historyKey("2026-09"), HISTORY);
    client.setQueryData(["chat", "sessions"], [1]);
    localStorage.setItem("hoondok:pending:read", "2026-09-19");
    localStorage.setItem("hoondok:install:eligible", "1");
    localStorage.setItem("hoondok:note:2026-09-19", "메모");
    localStorage.setItem("theme", "light");
    fetchMock.mockResolvedValueOnce(noContent());

    const { result } = renderHook(() => useDeleteMe(), { wrapper: createWrapper(client) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const { url, init, headers } = lastCall();
    expect(url).toBe("/api/backend/hoondok/auth/me");
    expect(init.method).toBe("DELETE");
    expect(headers.get("X-Requested-With")).toBe("XMLHttpRequest");

    expect(client.getQueryData(CURRENT_USER_KEY)).toBeNull();
    expect(client.getQueryData(SUMMARY_KEY)).toBeUndefined();
    expect(client.getQueryData(JEONGSEONG_KEY)).toBeUndefined();
    expect(client.getQueryData(historyKey("2026-09"))).toBeUndefined();
    expect(client.getQueryData(["chat", "sessions"])).toEqual([1]);

    expect(localStorage.getItem("hoondok:pending:read")).toBeNull();
    expect(localStorage.getItem("hoondok:install:eligible")).toBeNull();
    expect(localStorage.getItem("hoondok:note:2026-09-19")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("실패(403 CSRF·5xx) 시 캐시·로컬 키를 건드리지 않는다", async () => {
    const client = createClient();
    client.setQueryData(CURRENT_USER_KEY, USER);
    localStorage.setItem("hoondok:pending:read", "2026-09-19");
    fetchMock.mockResolvedValueOnce(json({ message: "CSRF" }, 403));

    const { result } = renderHook(() => useDeleteMe(), { wrapper: createWrapper(client) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toMatchObject({ status: 403 });
    expect(client.getQueryData(CURRENT_USER_KEY)).toEqual(USER);
    expect(localStorage.getItem("hoondok:pending:read")).toBe("2026-09-19");
  });

  it("localStorage 가 던져도 삭제 성공 흐름(캐시 정리)은 유지된다", async () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("blocked");
    });
    const client = createClient();
    client.setQueryData(CURRENT_USER_KEY, USER);
    fetchMock.mockResolvedValueOnce(noContent());

    const { result } = renderHook(() => useDeleteMe(), { wrapper: createWrapper(client) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(CURRENT_USER_KEY)).toBeNull();
  });
});
