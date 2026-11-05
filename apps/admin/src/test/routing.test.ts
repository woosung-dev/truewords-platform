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

  it("모든 경로에 프레임 금지 헤더를 붙인다 (보안 점검 web-missing-frame-protection-samesite-none)", async () => {
    const { default: config } = await import("../../next.config");
    const headers = (await config.headers?.()) ?? [];
    const all = headers.find((h) => h.source === "/:path*");
    expect(Object.fromEntries((all?.headers ?? []).map((x) => [x.key, x.value]))).toEqual({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
  });
});
