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

describe("웹 루트 = 훈독 (DEC-PWA-026)", () => {
  async function legacyRedirect(pathname: string): Promise<string | null> {
    const { getPathMatch } = await import("next/dist/shared/lib/router/utils/path-match");
    const { default: config } = await import("../../next.config");
    for (const rule of (await config.redirects?.()) ?? []) {
      // Next 가 redirects 를 맞출 때와 같은 옵션(server/lib/router-utils/filesystem.js buildCustomRoute)
      const params = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(pathname);
      if (params === false) continue;
      expect("permanent" in rule && rule.permanent, rule.source).toBe(rule.source.startsWith("/hoondok"));
      return rule.destination.replace(/:path\b/, String(params.path ?? ""));
    }
    return null;
  }

  it("예전 화면 주소(/hoondok·/hoondok/*)는 같은 경로의 루트로 308 한다", async () => {
    expect(await legacyRedirect("/hoondok")).toBe("/");
    expect(await legacyRedirect("/hoondok/read")).toBe("/read");
    expect(await legacyRedirect("/hoondok/c/abc123")).toBe("/c/abc123");
    expect(await legacyRedirect("/hoondok/c/abc123/image")).toBe("/c/abc123/image");
    expect(await legacyRedirect("/hoondok/groups/join")).toBe("/groups/join");
    expect(await legacyRedirect("/hoondok/ask/p/pq1")).toBe("/ask/p/pq1");
  });

  it("정적 자산·은퇴 SW·manifest 는 리다이렉트하지 않는다 (설치된 앱·알림·폰트가 이 URL 을 쓴다)", async () => {
    for (const asset of [
      "/hoondok/sw.js",
      "/hoondok/manifest.webmanifest",
      "/hoondok/fonts/pretendard-1.3.9/PretendardVariable.subset.0.woff2",
      "/hoondok/icons/icon-192.png",
      "/hoondok/photos/home-morning-field.webp",
      "/hoondok/cards/cup.webp",
      "/hoondok/mascot/owl-rest.webp",
      "/hoondok/voices/aoede.mp3",
    ]) {
      expect(await legacyRedirect(asset), asset).toBeNull();
    }
  });

  it("훈독 화면(/settings 등)은 관리자 앱으로 보내지 않고, 예전 관리 URL 만 보낸다", async () => {
    expect(await legacyRedirect("/")).toBeNull();
    expect(await legacyRedirect("/read")).toBeNull();
    expect(await legacyRedirect("/settings")).toBeNull();
    expect(await legacyRedirect("/dashboard")).toMatch(/^http:\/\/localhost:3001\/dashboard\//);
  });
});
