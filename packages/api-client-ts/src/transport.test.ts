import { describe, expect, it, vi } from "vitest";
import { getMeAdminAuthMeGet, loginAdminAuthLoginPost } from "./generated/sdk.gen";
import { ApiError, createApiClient } from "./index";

function setup(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  return { fetch, api: createApiClient({ baseUrl: "https://api.test", fetch }) };
}

describe("공유 REST transport", () => {
  it("JSON/쿠키/대소문자 method/Headers 객체를 보존한다", async () => {
    const { fetch, api } = setup(Response.json({ ok: true }));
    await api.request("/admin/users", { method: "post", body: "{}", headers: new Headers({ "x-trace": "test" }) });
    const [, init] = fetch.mock.calls[0];
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(init?.headers).get("x-trace")).toBe("test");
  });
  it("multipart에는 Content-Type을 강제하지 않는다", async () => {
    const { fetch, api } = setup(Response.json({ ok: true }));
    const body = new FormData();
    body.set("file", new Blob(["sample"]), "sample.txt");
    await api.request("/upload", { method: "POST", body, headers: { "Content-Type": "application/json" } });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).has("Content-Type")).toBe(false);
  });
  it("204는 JSON을 파싱하지 않는다", async () => {
    const { api } = setup(new Response(null, { status: 204 }));
    expect(await api.request("/record", { method: "DELETE" })).toEqual({});
  });
  for (const status of [401, 403, 422, 500]) {
    it(`${status}의 상태·오류 코드·추적 ID를 보존한다`, async () => {
      const onUnauthorized = vi.fn();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ error_code: "TEST", message: "실패", request_id: "req-1" }, { status }));
      const api = createApiClient({ fetch, onUnauthorized });
      await expect(api.request("/test")).rejects.toMatchObject({ status, errorCode: "TEST", requestId: "req-1" });
      expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    });
  }
  it("비JSON 오류·빈 오류에서도 HTTP 상태와 헤더 추적 ID를 보존한다", async () => {
    const { api } = setup(
      new Response("upstream unavailable", { status: 502, headers: { "x-request-id": "proxy-1" } }),
    );
    await expect(api.request("/test")).rejects.toMatchObject({
      status: 502,
      message: "upstream unavailable",
      requestId: "proxy-1",
    });
  });
  it("잘못된 JSON 응답과 비JSON 성공을 정상 DTO로 위장하지 않는다", async () => {
    const { api } = setup(new Response("<html>gateway</html>", { headers: { "content-type": "text/html" } }));
    await expect(api.request("/test")).rejects.toMatchObject({ errorCode: "INVALID_RESPONSE" });
  });
  it("취소와 네트워크 오류를 원형 그대로 전달한다", async () => {
    const error = new DOMException("Aborted", "AbortError");
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(error);
    const signal = AbortSignal.abort();
    await expect(createApiClient({ fetch }).request("/test", { signal })).rejects.toBe(error);
    expect(fetch.mock.calls[0][1]?.signal).toBe(signal);
  });
  it("SDK GET도 동일한 transport와 생성 응답 타입을 사용한다", async () => {
    const { api, fetch } = setup(Response.json({ id: "user-1", email: "user@example.test", name: "사용자" }));
    const result = await getMeAdminAuthMeGet({ client: api.client, throwOnError: true });
    expect(result.data.email).toBe("user@example.test");
    expect(fetch.mock.calls[0][1]?.credentials).toBe("include");
  });
  it("SDK mutation도 CSRF 헤더와 구조화된 ApiError를 보존한다", async () => {
    const { api, fetch } = setup(
      Response.json({ message: "로그인 실패", error_code: "UNAUTHORIZED" }, { status: 401 }),
    );
    await expect(
      loginAdminAuthLoginPost({
        client: api.client,
        body: { email: "user@example.test", password: "invalid" },
        throwOnError: true,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
  });
  it("호출 경로가 API origin을 우회할 수 없다", async () => {
    const { api, fetch } = setup(Response.json({}));
    await expect(api.request("//external.test/path")).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
