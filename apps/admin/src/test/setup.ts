import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom 에 미구현 — element.scrollIntoView 호출 테스트용
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
