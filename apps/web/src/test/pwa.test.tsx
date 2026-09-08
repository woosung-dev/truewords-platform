import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("훈독 PWA 셸", () => {
  it("manifest 는 설치 이름·시작 URL·아이콘·standalone 을 가진다", async () => {
    const { HOONDOK_MANIFEST, default: manifest } = await import("../app/manifest");
    const m = manifest();
    expect(m).toBe(HOONDOK_MANIFEST);
    expect(m.short_name).toBe("훈독");
    expect(m.start_url).toBe("/hoondok");
    expect(m.display).toBe("standalone");
    expect(m.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(m.name).toContain("독립 운영 베타");
  });

  it("플래그가 없으면 서비스워커를 등록하지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_PWA_ENABLED", "");
    const register = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, serviceWorker: { register } });
    const { registerServiceWorker } = await import("../components/pwa/pwa-register");
    await expect(registerServiceWorker()).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("플래그가 켜지면 /sw.js 를 scope / 로 등록한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_PWA_ENABLED", "1");
    const registration = { scope: "/" };
    const register = vi.fn().mockResolvedValue(registration);
    vi.stubGlobal("navigator", { ...navigator, serviceWorker: { register } });
    const { registerServiceWorker } = await import("../components/pwa/pwa-register");
    await expect(registerServiceWorker()).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("데모 화면은 플래그가 꺼진 상태를 알리고 권한 요청 버튼을 잠근다", async () => {
    vi.stubEnv("NEXT_PUBLIC_PWA_ENABLED", "");
    const { default: HoondokPwaDemo } = await import("../app/hoondok/pwa-demo");
    render(<HoondokPwaDemo />);
    expect(await screen.findByText(/NEXT_PUBLIC_PWA_ENABLED=1/)).toBeInTheDocument();
    expect(screen.getByText(/독립 운영 베타/)).toBeInTheDocument();
    const button = screen.queryByRole("button", { name: /알림 켜기/ });
    if (button) expect(button).toBeDisabled();
  });
});
