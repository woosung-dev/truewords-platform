import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoondokErrorListener } from "@/features/hoondok/observability/listener";
import { hoondokFetch, reportClientError, safeHoondokPath } from "@/features/hoondok/observability/report";

beforeEach(() => {
  window.history.replaceState({}, "", "/hoondok/search?q=private");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("클라이언트 오류 수집", () => {
  it("검색어·질문·노트·예외를 전송하지 않고 동적 경로도 템플릿으로 바꾼다", async () => {
    expect(safeHoondokPath("/hoondok/words/secret-volume?token=private")).toBe("/hoondok/words/:volume");
    expect(safeHoondokPath("/hoondok/ask/private-question#secret")).toBe("/hoondok/ask/:id");
    expect(safeHoondokPath("/hoondok/unknown-private-segment")).toBe("/hoondok");
    render(<HoondokErrorListener />);
    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", { message: "secret note and token", error: new Error("secret question") }),
      );
    });
    const call = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(call[1]?.body))).toEqual({ kind: "unhandled", path: "/hoondok/search" });
    expect(JSON.stringify(call)).not.toMatch(/secret|private|token/);
  });
  it("훈독 레이아웃을 떠나면 두 전역 리스너를 해제한다", () => {
    const { unmount } = render(<HoondokErrorListener />);
    unmount();
    window.dispatchEvent(new Event("error"));
    window.dispatchEvent(new Event("unhandledrejection"));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("잡힌 API 5xx도 보고하되 원래 응답은 보존하고 보고 실패를 반복하지 않는다", async () => {
    const response = new Response("unavailable", { status: 503 });
    vi.mocked(fetch).mockResolvedValueOnce(response).mockRejectedValueOnce(new Error("report unavailable"));
    await expect(hoondokFetch("/api/backend/hoondok/search?q=secret")).resolves.toBe(response);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({
      kind: "api_5xx",
      path: "/hoondok/search",
    });
  });
  it("시연 챗 화면은 수집하지 않는다", () => {
    window.history.replaceState({}, "", "/");
    reportClientError("unhandled");
    expect(fetch).not.toHaveBeenCalled();
  });
});
