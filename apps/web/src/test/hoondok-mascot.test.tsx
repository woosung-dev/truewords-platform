// 부엉이 마스코트 플래그: OFF 면 기존 아이콘이 그대로이고, ON 이면 같은 자리에 장식 그림(alt 빈 값)만 들어간다.
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HoondokOfflinePage from "@/app/(hoondok)/offline/page";

afterEach(() => vi.unstubAllEnvs());

describe("훈독 부엉이 마스코트 플래그", () => {
  it("미설정이면 오프라인 안내에 기존 아이콘만 있고 부엉이가 없다", () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_MASCOT", "");
    const { container } = render(<HoondokOfflinePage />);
    expect(container.querySelector(".owl")).toBeNull();
    expect(container.querySelector(".empty__ic svg")).not.toBeNull();
  });

  it("1 이면 아이콘 자리에 쉬는 부엉이가 장식으로 들어가고 문구는 그대로다", () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_MASCOT", "1");
    const { container, getByRole } = render(<HoondokOfflinePage />);
    const owl = container.querySelector<HTMLImageElement>(".empty__ic img.owl");
    expect(owl?.getAttribute("src")).toBe("/hoondok/mascot/owl-rest.webp");
    expect(owl?.getAttribute("alt")).toBe("");
    expect(owl?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".empty__ic svg")).toBeNull();
    expect(getByRole("heading", { name: "지금은 오프라인이에요" })).toBeTruthy();
  });
});
