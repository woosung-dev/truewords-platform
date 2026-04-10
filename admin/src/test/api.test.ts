import { describe, it, expect, vi, beforeEach } from "vitest";

// fetchAPI는 모듈 내부 함수이므로 fetch를 mock하여 간접 테스트
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// 테스트마다 import를 새로 해야 하므로 dynamic import 사용
let authAPI: typeof import("@/features/auth/api").authAPI;
let chatbotAPI: typeof import("@/features/chatbot/api").chatbotAPI;

beforeEach(async () => {
  vi.clearAllMocks();
  const authMod = await import("@/features/auth/api");
  authAPI = authMod.authAPI;
  const chatbotMod = await import("@/features/chatbot/api");
  chatbotAPI = chatbotMod.chatbotAPI;
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
    expect(options.headers["X-Requested-With"]).toBe("XMLHttpRequest");
  });

  it("me는 GET 요청이다", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ user_id: "abc", role: "admin" })
    );

    const result = await authAPI.me();

    expect(result.role).toBe("admin");
    // GET은 X-Requested-With 없음
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["X-Requested-With"]).toBeUndefined();
  });

  it("401 응답 시 에러를 throw한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: () => Promise.resolve("Unauthorized"),
    });

    // window.location 리다이렉트는 jsdom에서 동작하지 않으므로 에러만 확인
    await expect(authAPI.me()).rejects.toThrow("인증이 필요합니다");
  });
});

describe("chatbotAPI", () => {
  it("list는 pagination 파라미터를 포함한다", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ items: [], total: 0, limit: 20, offset: 0 })
    );

    await chatbotAPI.list(10, 20);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/admin/chatbot-configs?limit=10&offset=20"),
      expect.anything()
    );
  });

  it("get은 단건 조회한다", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: "abc", chatbot_id: "test" })
    );

    const result = await chatbotAPI.get("abc");

    expect(result.id).toBe("abc");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/admin/chatbot-configs/abc"),
      expect.anything()
    );
  });

  it("create는 POST + CSRF 헤더로 호출한다", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: "new-id", chatbot_id: "new" })
    );

    await chatbotAPI.create({
      chatbot_id: "new",
      display_name: "New Bot",
    });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.headers["X-Requested-With"]).toBe("XMLHttpRequest");
  });

  it("update는 PUT + CSRF 헤더로 호출한다", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: "abc", display_name: "Updated" })
    );

    await chatbotAPI.update("abc", { display_name: "Updated" });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/admin/chatbot-configs/abc");
    expect(options.method).toBe("PUT");
    expect(options.headers["X-Requested-With"]).toBe("XMLHttpRequest");
  });

  it("에러 응답 시 에러 메시지를 throw한다", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers(),
      text: () => Promise.resolve("chatbot_id 이미 존재합니다"),
    });

    await expect(
      chatbotAPI.create({ chatbot_id: "dup", display_name: "Dup" })
    ).rejects.toThrow("chatbot_id 이미 존재합니다");
  });
});
