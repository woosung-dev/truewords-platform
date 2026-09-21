import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/backend/hoondok/search/route";
import nextConfig from "../../next.config";

const PRIVATE_QUERY = "PRIVATE_QUERY_123";
const url = `https://web.example/api/backend/hoondok/search?q=${PRIVATE_QUERY}&limit=7`;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("검색 전용 웹 프록시", () => {
  it("검색 계약과 Cloudflare 요청 제한 헤더를 보존하고 쿠키를 전달하지 않는다", async () => {
    const fetch = vi.fn(async () => Response.json({ results: [] }, { headers: { "X-Request-ID": "request-1" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await GET(
      new Request(url, {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          "X-Forwarded-For": "192.0.2.2",
          Cookie: "hoondok_token=private-token",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [] });
    const [target, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(target)).toContain(`/hoondok/search?q=${PRIVATE_QUERY}&limit=7`);
    expect(new Headers(init?.headers).get("cf-connecting-ip")).toBe("192.0.2.1");
    expect(new Headers(init?.headers).get("x-forwarded-for")).toBe("192.0.2.2");
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("request-1");
  });
  it.each([422, 429, 503])("백엔드 %i 응답을 그대로 전달한다", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "backend response" }, { status, headers: { "Retry-After": "60" } })),
    );
    const response = await GET(new Request(url));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ message: "backend response" });
    expect(response.headers.get("retry-after")).toBe("60");
  });
  it("연결 실패의 원문 예외와 검색 URL을 로그·응답에 넣지 않고 고정 503을 반환한다", async () => {
    const log = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`Failed to proxy ${url}`);
      }),
    );
    const response = await GET(new Request(url));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error_code).toBe("SEARCH_FAILED");
    expect(JSON.stringify(body)).not.toContain(PRIVATE_QUERY);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
  it("응답 본문 수신 실패도 같은 비식별 503으로 처리한다", async () => {
    const response = new Response("partial");
    vi.spyOn(response, "arrayBuffer").mockRejectedValue(new Error(url));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const result = await GET(new Request(url));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(PRIVATE_QUERY);
  });
  it("개발 요청 로그는 검색 경로만 제외한다", () => {
    const logging = nextConfig.logging;
    if (!logging || typeof logging.incomingRequests !== "object") throw new Error("missing search logging exclusions");
    const ignored = (path: string) =>
      logging.incomingRequests &&
      typeof logging.incomingRequests === "object" &&
      logging.incomingRequests.ignore?.some((pattern) => pattern.test(path));
    expect(ignored(`/api/backend/hoondok/search?q=${PRIVATE_QUERY}`)).toBe(true);
    expect(ignored(`/hoondok/search?q=${PRIVATE_QUERY}`)).toBe(true);
    expect(ignored("/api/backend/chat/stream")).toBe(false);
    expect(ignored("/hoondok/read")).toBe(false);
  });
});
