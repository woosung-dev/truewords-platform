import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoondokTextScale } from "@/features/hoondok/settings/components/text-scale-root";
import { TextScaleSetting } from "@/features/hoondok/settings/components/text-scale-setting";
import { readTextScale, toTextScaleId, writeTextScale } from "@/features/hoondok/settings/text-scale";

const KEY = "hoondok:text-scale";

function renderRoot() {
  const view = render(
    <div data-app="hoondok">
      <HoondokTextScale />
      <TextScaleSetting />
    </div>,
  );
  const root = view.container.querySelector<HTMLElement>('[data-app="hoondok"]');
  if (!root) throw new Error("훈독 루트가 없다");
  return root;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("말씀 글자 크기 저장값", () => {
  it("모르는 값·빈 값은 보통으로 본다", () => {
    expect(toTextScaleId("larger")).toBe("larger");
    expect(toTextScaleId("huge")).toBe("normal");
    expect(toTextScaleId(null)).toBe("normal");
    localStorage.setItem(KEY, "1.5");
    expect(readTextScale()).toBe("normal");
  });

  it("저장소가 막혀도 던지지 않고 보통으로 읽는다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTextScale()).toBe("normal");
    expect(() => writeTextScale("large")).not.toThrow();
  });

  it("보통으로 돌리면 키를 지운다", () => {
    writeTextScale("largest");
    expect(localStorage.getItem(KEY)).toBe("largest");
    writeTextScale("normal");
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("말씀 글자 크기 설정", () => {
  it("고르면 이 기기에 저장되고 훈독 루트의 --read-scale 이 바로 바뀐다", () => {
    const root = renderRoot();
    expect(screen.getByRole("radio", { name: "보통" })).toBeChecked();
    expect(root.style.getPropertyValue("--read-scale")).toBe("");

    fireEvent.click(screen.getByRole("radio", { name: "더 크게" }));
    expect(localStorage.getItem(KEY)).toBe("larger");
    expect(root.style.getPropertyValue("--read-scale")).toBe("1.25");
    expect(screen.getByRole("radio", { name: "더 크게" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "보통" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "보통" }));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(root.style.getPropertyValue("--read-scale")).toBe("");
  });

  it("저장해 둔 크기는 다시 열 때 루트와 선택 표시에 그대로 걸린다", () => {
    localStorage.setItem(KEY, "largest");
    const root = renderRoot();
    expect(root.style.getPropertyValue("--read-scale")).toBe("1.375");
    expect(screen.getByRole("radio", { name: "아주 크게" })).toBeChecked();
  });

  it("다른 탭에서 바꾼 값(storage 이벤트)도 따라간다", () => {
    const root = renderRoot();
    localStorage.setItem(KEY, "large");
    fireEvent(window, new StorageEvent("storage", { key: KEY }));
    expect(root.style.getPropertyValue("--read-scale")).toBe("1.125");
    expect(screen.getByRole("radio", { name: "크게" })).toBeChecked();
  });
});
