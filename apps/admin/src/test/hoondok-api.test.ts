import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchAPI 는 fetch 를 감싸므로 fetch 를 mock 해 URL·메서드·헤더를 본다 (api.test.ts 와 같은 방식)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let hoondokAPI: typeof import("@/features/hoondok/api").hoondokAPI;
let saveErrorMessage: typeof import("@/features/hoondok/api").saveErrorMessage;
let ApiError: typeof import("@/lib/api").ApiError;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ hoondokAPI, saveErrorMessage } = await import("@/features/hoondok/api"));
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

describe("hoondokAPI", () => {
  it("list 는 from·to 를 항상 쿼리로 보낸다", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await hoondokAPI.list("2026-09-19", "2026-10-03");
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/admin/hoondok/daily-readings?from=2026-09-19&to=2026-10-03");
    expect(options.credentials).toBe("include");
    expect(new Headers(options.headers).get("X-Requested-With")).toBeNull();
  });

  it("create 는 POST + CSRF 헤더 + JSON 본문", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "new" }, 201));
    await hoondokAPI.create({
      reading_date: "2026-09-19",
      title: "t",
      body: "b",
      speaker: "s",
      work_title: "w",
      authority_grade: "R",
    });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/admin/hoondok/daily-readings");
    expect(options.method).toBe("POST");
    expect(new Headers(options.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
    expect(JSON.parse(options.body).reading_date).toBe("2026-09-19");
  });

  it("update 는 PUT /{id} + CSRF 헤더", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "abc" }));
    await hoondokAPI.update("abc", { review_status: "withdrawn" });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/admin/hoondok/daily-readings/abc");
    expect(options.method).toBe("PUT");
    expect(new Headers(options.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
  });

  it("409 detail 은 ApiError.status 409 + 서버 문구로 보존된다", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "그 날짜에는 이미 편성이 있어요" }, 409));
    const error = await hoondokAPI
      .create({
        reading_date: "2026-09-19",
        title: "t",
        body: "b",
        speaker: "s",
        work_title: "w",
        authority_grade: "R",
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).status).toBe(409);
    expect(saveErrorMessage(error, "저장에 실패했습니다")).toBe("그 날짜에는 이미 편성이 있어요");
  });

  it("saveErrorMessage 는 422 는 입력 안내, 그 외는 fallback", () => {
    expect(saveErrorMessage(new ApiError(422, { message: "x" }), "fallback")).toBe("입력값을 확인해 주세요");
    expect(saveErrorMessage(new ApiError(500, { message: "x" }), "fallback")).toBe("fallback");
    expect(saveErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });
});
