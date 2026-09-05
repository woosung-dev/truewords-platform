import { describe, it, expect, vi, beforeEach } from "vitest";

// fetchAPI는 모듈 내부 함수이므로 fetch를 mock하여 간접 테스트
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// 테스트마다 import를 새로 해야 하므로 dynamic import 사용
let authAPI: typeof import("@/features/auth/api").authAPI;

beforeEach(async () => {
  vi.clearAllMocks();
  const authMod = await import("@/features/auth/api");
  authAPI = authMod.authAPI;
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

describe("authAPI", () => {
  it("login은 POST + credentials include로 호출한다", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: "로그인 성공" }));

    await authAPI.login("test@test.com", "pw123");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/admin/auth/login"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });

  it("login은 X-Requested-With 헤더를 포함한다 (CSRF)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: "ok" }));

    await authAPI.login("test@test.com", "pw123");

    const [, options] = mockFetch.mock.calls[0];
    expect(new Headers(options.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
  });

  it("me는 GET 요청이다", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ user_id: "abc", role: "admin" })
    );

    const result = await authAPI.me();

    expect(result.role).toBe("admin");
    // GET은 X-Requested-With 없음
    const [, options] = mockFetch.mock.calls[0];
    expect(new Headers(options.headers).get("X-Requested-With")).toBeNull();
  });

  it("401 응답 시 에러를 throw한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: () => Promise.resolve("Unauthorized"),
    });

    // window.location 리다이렉트는 jsdom에서 동작하지 않으므로 에러만 확인
    await expect(authAPI.me()).rejects.toThrow("Unauthorized");
  });
});


/**
 * 회귀 방지 — 2026-05-08 운영 INPUT_BLOCKED / SEARCH_FAILED 가 raw JSON 으로
 * 화면에 노출되던 결함. fetchAPI 가 ErrorResponse 를 ApiError 로 보존해야
 * UI 측이 error_code 로 분기 가능.
 */
describe("ApiError — fetchAPI 가 ErrorResponse 를 구조 보존한다", () => {
  let api: typeof import("@/lib/api");

  beforeEach(async () => {
    api = await import("@/lib/api");
  });

  it("application/json 응답은 error_code / message / request_id 를 보존한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          error_code: "INPUT_BLOCKED",
          message: "허용되지 않는 입력 패턴이 감지되었습니다.",
          request_id: "req-abc",
        }),
      text: () => Promise.resolve("{}"),
    });

    let caught: unknown;
    try {
      await api.fetchAPI("/admin/whatever");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(api.ApiError);
    const err = caught as InstanceType<typeof api.ApiError>;
    expect(err.status).toBe(400);
    expect(err.errorCode).toBe("INPUT_BLOCKED");
    expect(err.requestId).toBe("req-abc");
    expect(err.message).toBe("허용되지 않는 입력 패턴이 감지되었습니다.");
  });

  it("503 SEARCH_FAILED 도 동일 구조로 보존된다 (Qdrant 다운 시나리오)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          error_code: "SEARCH_FAILED",
          message: "검색 서비스에 일시적 장애가 발생했습니다. 잠시 후 다시 시도해주세요.",
          request_id: "req-xyz",
        }),
      text: () => Promise.resolve("{}"),
    });

    await expect(api.fetchAPI("/api/chat")).rejects.toMatchObject({
      status: 503,
      errorCode: "SEARCH_FAILED",
    });
  });

  it("plain text 응답은 raw text 가 message 로 들어가지만 errorCode 는 undefined", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      headers: new Headers({ "content-type": "text/html" }),
      text: () => Promise.resolve("<html>Bad Gateway</html>"),
    });

    let caught: unknown;
    try {
      await api.fetchAPI("/api/chat");
    } catch (e) {
      caught = e;
    }
    const err = caught as InstanceType<typeof api.ApiError>;
    expect(err.status).toBe(502);
    expect(err.errorCode).toBeUndefined();
    expect(err.message).toContain("Bad Gateway");
  });

  it("401은 ApiError로 보존하되 서버가 보내지 않은 error_code를 만들지 않는다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: () => Promise.resolve("Unauthorized"),
    });

    let caught: unknown;
    try {
      await api.fetchAPI("/admin/me");
    } catch (e) {
      caught = e;
    }
    const err = caught as InstanceType<typeof api.ApiError>;
    expect(err).toBeInstanceOf(api.ApiError);
    expect(err.status).toBe(401);
    expect(err.errorCode).toBeUndefined();
  });
});
