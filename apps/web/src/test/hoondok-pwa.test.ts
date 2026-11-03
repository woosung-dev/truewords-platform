import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 훈독 PWA 설치 메타 (PLAN-HD-001 Phase 3 C). manifest·아이콘·폰트는 public 정적 파일이라 파일 자체를 단언한다.
const WEB_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_DIR = path.join(WEB_ROOT, "public");
const HOONDOK_CSS = readFileSync(path.join(WEB_ROOT, "src/app/hoondok.css"), "utf8");
const PAPER = HOONDOK_CSS.match(/--paper:\s*(#[0-9a-f]{6})/i)?.[1];

type ManifestIcon = { src: string; sizes: string; type: string; purpose: string };
type Manifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
};
const manifest: Manifest = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "hoondok/manifest.webmanifest"), "utf8"));

// PNG IHDR: 16~19 바이트 폭, 20~23 바이트 높이 (big-endian)
function pngSize(file: string) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function loadLayout(flag: string) {
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_ENABLED", flag);
  vi.resetModules();
  vi.doMock("next/navigation", () => ({ notFound: vi.fn(), usePathname: () => "/" }));
  return import("../app/(hoondok)/layout");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("훈독 PWA 설치 메타", () => {
  it("플래그 ON 이면 manifest·apple-touch·theme-color 를 붙이고 OFF 면 붙이지 않는다", async () => {
    const on = await loadLayout("1");
    const meta = on.generateMetadata();
    expect(meta.manifest).toBe("/hoondok/manifest.webmanifest");
    expect(meta.appleWebApp).toMatchObject({ capable: true, title: "훈독" });
    expect(meta.icons).toMatchObject({ apple: [{ url: "/hoondok/icons/apple-touch-icon-180.png" }] });
    // 루트 app/favicon.ico(Next 기본 삼각형, sizes 256x256)도 함께 붙으므로 탭 크기에 딱 맞는 32 가 있어야 탭에서 이긴다
    expect(meta.icons).toMatchObject({
      icon: expect.arrayContaining([{ url: "/hoondok/icons/favicon-32.png", sizes: "32x32", type: "image/png" }]),
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(on.generateViewport().themeColor).toBe(PAPER);

    const off = await loadLayout("");
    const offMeta = off.generateMetadata();
    expect(offMeta.manifest).toBeUndefined();
    expect(offMeta.appleWebApp).toBeUndefined();
    expect(offMeta.icons).toBeUndefined();
    expect(offMeta.robots).toEqual({ index: false, follow: false });
    expect(off.generateViewport().themeColor).toBeUndefined();
  });

  it("manifest 는 루트 스코프·standalone·베타 고지·--paper 색이고 id 는 예전 값 그대로다", () => {
    // 웹 루트가 훈독이다(DEC-PWA-026). id 를 바꾸면 설치된 앱이 다른 앱이 된다 — 예전 start_url 이던 /hoondok 을 유지한다.
    expect(manifest).toMatchObject({
      id: "/hoondok",
      start_url: "/",
      scope: "/",
      display: "standalone",
      name: "훈독",
      short_name: "훈독",
      lang: "ko",
    });
    expect(manifest.description).toContain("독립 운영 베타");
    expect(manifest.description).not.toContain("공식 앱이"); // REQ-PWA-001 독립 베타 정체성
    expect(PAPER).toBeDefined();
    expect(manifest.theme_color).toBe(PAPER);
    expect(manifest.background_color).toBe(PAPER);
  });

  it("아이콘 파일이 존재하고 PNG 크기가 sizes 와 같다 (192·512 any · 512 maskable · apple 180 · 파비콘 32)", () => {
    expect(manifest.icons.map((icon) => icon.purpose)).toEqual(["any", "any", "maskable"]);
    for (const icon of manifest.icons) {
      // 설치된 앱은 아이콘 URL 이 바뀌어야 새 그림을 받는다 — 그림을 바꾸면 ?v= 를 올린다
      expect(icon.src, icon.src).toMatch(/\.png\?v=\d{8}$/);
      const file = path.join(PUBLIC_DIR, icon.src.split("?")[0]);
      expect(existsSync(file), icon.src).toBe(true);
      expect(icon.type).toBe("image/png");
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(file), icon.src).toEqual({ width, height });
    }
    expect(pngSize(path.join(PUBLIC_DIR, "hoondok/icons/apple-touch-icon-180.png"))).toEqual({
      width: 180,
      height: 180,
    });
    expect(pngSize(path.join(PUBLIC_DIR, "hoondok/icons/favicon-32.png"))).toEqual({ width: 32, height: 32 });
    expect(pngSize(path.join(PUBLIC_DIR, "hoondok/icons/logo-64.png"))).toEqual({ width: 64, height: 64 });
  });

  it("Pretendard self-host: 동적 서브셋 조각마다 파일이 있고 OFL 동봉 + 별도 패밀리명 @font-face", () => {
    const fontCss = readFileSync(path.resolve(__dirname, "../app/hoondok-pretendard.css"), "utf8");
    const urls = [...fontCss.matchAll(/url\("(\/hoondok\/fonts\/pretendard-1\.3\.9\/[^"]+\.woff2)"\)/g)].map(
      (m) => m[1],
    );
    expect(urls.length).toBeGreaterThan(80);
    for (const url of urls) {
      // 조각 하나는 작아야 한다 — 전체 파일(2MB)이 섞여 들어오면 서브셋의 의미가 없다
      expect(statSync(path.join(PUBLIC_DIR, url)).size, url).toBeLessThanOrEqual(64 * 1024);
    }
    expect(fontCss.match(/font-family:"Pretendard Hoondok"/g)?.length).toBe(urls.length);
    expect(fontCss.match(/unicode-range:/g)?.length).toBe(urls.length);
    expect(existsSync(path.join(PUBLIC_DIR, "hoondok/fonts/OFL.txt"))).toBe(true);
    expect(HOONDOK_CSS).toMatch(/--sans:\s*"Pretendard Hoondok",/);
  });
});

describe("훈독 서비스워커 등록 컴포넌트 (Phase 3 D)", () => {
  it("플래그 ON 이면 /sw.js 를 scope / 으로 등록하고 예전 /hoondok 등록만 해제한다, serviceWorker 미지원이면 no-op", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_ENABLED", "1");
    vi.resetModules();
    const { HoondokServiceWorker } = await import("../features/hoondok/service-worker");

    // jsdom 은 navigator.serviceWorker 를 구현하지 않는다 → 미지원 분기
    expect("serviceWorker" in navigator).toBe(false);
    expect(render(createElement(HoondokServiceWorker)).container.innerHTML).toBe("");

    const register = vi.fn(() => Promise.resolve({}));
    const legacy = { scope: `${window.location.origin}/hoondok`, unregister: vi.fn(async () => true) };
    const current = { scope: `${window.location.origin}/`, unregister: vi.fn(async () => true) };
    const getRegistrations = vi.fn(async () => [legacy, current]);
    Object.defineProperty(navigator, "serviceWorker", { value: { register, getRegistrations }, configurable: true });
    try {
      render(createElement(HoondokServiceWorker));
      await vi.waitFor(() => expect(legacy.unregister).toHaveBeenCalledOnce());
      expect(current.unregister).not.toHaveBeenCalled();
      // updateViaCache:"none" 을 함께 단언한다. Cloudflare 가 sw.js 의 오리진 no-cache 를
      // 4시간으로 덮어쓰므로, 이 옵션이 빠지면 SW_KILL 배포가 그만큼 지연된다.
      expect(register).toHaveBeenCalledWith("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("플래그 OFF 면 등록하지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_ENABLED", "");
    vi.resetModules();
    const { HoondokServiceWorker } = await import("../features/hoondok/service-worker");
    const register = vi.fn(() => Promise.resolve({}));
    Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
    try {
      render(createElement(HoondokServiceWorker));
      expect(register).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });
});
