import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("독립 앱 라우팅", () => {
  it("정규 프록시와 기존 reactions alias의 실제 API 경로를 보존한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://fixture-api:8000");
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    const rewrites = await config.rewrites?.();
    expect(rewrites).toEqual(
      expect.arrayContaining([
        { source: "/api/backend/:path*", destination: "http://fixture-api:8000/:path*" },
        { source: "/api/chat/messages/:path*", destination: "http://fixture-api:8000/api/chat/messages/:path*" },
        { source: "/api/chat/:path*", destination: "http://fixture-api:8000/chat/:path*" },
      ]),
    );
  });
});
