import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const READING = {
  id: "6f1c0000-0000-4000-8000-000000000001",
  reading_date: "2026-09-17",
  title: "참사랑은 직단거리를 갑니다",
  body: "참사랑은 직단거리를 갑니다.",
  speaker: "참아버님",
  spoken_on: null,
  work_title: "천성경",
  edition: null,
  authority_grade: "O1",
  review_status: "reviewed",
  estimated_minutes: 3,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("loadToday (API-HD-001)", () => {
  it("API origin 으로 직접 요청하고 3상태를 그대로 넘긴다", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://fixture-api:8000");
    vi.resetModules();
    const { loadToday } = await import("../features/hoondok/api");
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return jsonResponse({ date: "2026-09-17", status: "available", reading: READING });
    }) as unknown as typeof fetch;

    const result = await loadToday(fetchImpl);

    expect(calls).toEqual(["http://fixture-api:8000/hoondok/today"]);
    expect(result.status).toBe("available");
    expect(result.reading?.title).toBe("참사랑은 직단거리를 갑니다");
    expect(result.error).toBeUndefined();

    for (const status of ["none", "withdrawn"] as const) {
      const r = await loadToday((async () =>
        jsonResponse({ date: "2026-09-17", status, reading: null })) as typeof fetch);
      expect(r.status).toBe(status);
      expect(r.reading).toBeNull();
    }
  });

  it("네트워크 오류·5xx 는 none + error 로 돌려 화면이 깨지지 않는다", async () => {
    const { loadToday } = await import("../features/hoondok/api");
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const result = await loadToday(failing);
    expect(result.status).toBe("none");
    expect(result.reading).toBeNull();
    expect(result.error).toContain("fetch failed");
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const serverError = (async () =>
      jsonResponse({ error_code: "INTERNAL_ERROR", message: "서버 내부 오류", request_id: "r" }, 500)) as typeof fetch;
    const r500 = await loadToday(serverError);
    expect(r500.status).toBe("none");
    expect(r500.error).toBeTruthy();
  });
});
