import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchAPI 는 fetch 를 감싸므로 fetch 를 mock 해 URL·메서드·CSRF 헤더를 본다 (hoondok-api.test.ts 와 같은 방식)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let jeongseongAPI: typeof import("@/features/hoondok/jeongseong-api").jeongseongAPI;
let groupsModule: typeof import("@/features/hoondok/groups-api");
let ApiError: typeof import("@/lib/api").ApiError;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ jeongseongAPI } = await import("@/features/hoondok/jeongseong-api"));
  groupsModule = await import("@/features/hoondok/groups-api");
  ({ ApiError } = await import("@/lib/api"));
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function noContent() {
  return {
    ok: true,
    status: 204,
    headers: new Headers(),
    json: () => Promise.reject(),
    text: () => Promise.resolve(""),
  };
}

const payload = { title: "추석", started_on: "2026-09-23", duration_days: 40, source_note: null };

describe("jeongseongAPI (API-HD-042)", () => {
  it("list 는 GET, CSRF 헤더 없음", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await jeongseongAPI.list();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/admin\/hoondok\/jeongseongs$/);
    expect(new Headers(options.headers).get("X-Requested-With")).toBeNull();
  });

  it("create 는 POST + CSRF + 본문 그대로", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "j1" }, 201));
    await jeongseongAPI.create(payload);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/admin\/hoondok\/jeongseongs$/);
    expect(options.method).toBe("POST");
    expect(new Headers(options.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  it("update 는 PUT /{id} 전체 교체", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "j1" }));
    await jeongseongAPI.update("j1", payload);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/admin\/hoondok\/jeongseongs\/j1$/);
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  it("remove 는 DELETE /{id} + CSRF, 204 를 받아들인다", async () => {
    mockFetch.mockResolvedValueOnce(noContent());
    await jeongseongAPI.remove("j1");
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/admin\/hoondok\/jeongseongs\/j1$/);
    expect(options.method).toBe("DELETE");
    expect(new Headers(options.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
  });
});

describe("groupsAPI (API-HD-043)", () => {
  it("list GET · remove DELETE + CSRF", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await groupsModule.groupsAPI.list();
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/admin\/hoondok\/groups$/);

    mockFetch.mockResolvedValueOnce(noContent());
    await groupsModule.groupsAPI.remove("g1");
    const [url, options] = mockFetch.mock.calls[1];
    expect(url).toMatch(/\/admin\/hoondok\/groups\/g1$/);
    expect(options.method).toBe("DELETE");
    expect(new Headers(options.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
  });

  it("삭제 404 는 ApiError 404 로 보존되어 부드러운 문구가 된다", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "모임을 찾을 수 없어요" }, 404));
    const error = await groupsModule.groupsAPI.remove("gone").catch((e: unknown) => e);
    expect(groupsModule.isNotFound(error)).toBe(true);
    expect(groupsModule.mutationErrorMessage(error, "fallback")).toBe("이미 삭제된 항목이에요. 목록을 새로 고쳤어요");
  });
});

describe("오류 문구", () => {
  it("변경 실패 — 401·403·422·기타", () => {
    const { mutationErrorMessage } = groupsModule;
    expect(mutationErrorMessage(new ApiError(401, { message: "x" }), "f")).toContain("로그인");
    expect(mutationErrorMessage(new ApiError(403, { message: "x" }), "f")).toContain("권한");
    expect(mutationErrorMessage(new ApiError(422, { message: "x" }), "f")).toBe("입력값을 확인해 주세요");
    expect(mutationErrorMessage(new ApiError(500, { message: "x" }), "f")).toBe("f");
    expect(mutationErrorMessage(new Error("boom"), "f")).toBe("f");
  });

  it("조회 실패 — 403 은 권한 안내, 그 외는 fallback", () => {
    const { loadErrorMessage } = groupsModule;
    expect(loadErrorMessage(new ApiError(403, { message: "x" }), "f")).toBe("이 화면을 볼 권한이 없어요");
    expect(loadErrorMessage(new ApiError(401, { message: "x" }), "f")).toContain("로그인");
    expect(loadErrorMessage(new ApiError(500, { message: "x" }), "f")).toBe("f");
  });
});

describe("formatKstDate", () => {
  it("시간대 없는 UTC 문자열을 KST 날짜로 — 15시 UTC 는 다음 날", () => {
    expect(groupsModule.formatKstDate("2026-09-23T14:59:59")).toBe("2026-09-23");
    expect(groupsModule.formatKstDate("2026-09-23T15:00:00.123456")).toBe("2026-09-24");
    expect(groupsModule.formatKstDate("2026-09-23T15:00:00Z")).toBe("2026-09-24");
    expect(groupsModule.formatKstDate("nonsense")).toBe("nonsense");
  });
});
