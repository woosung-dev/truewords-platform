import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// 시연 관리자 게이트 계정(빌드 env). constants.ts 가 모듈 로드 시 읽으므로 setup 에서 먼저 고정한다.
// 게이트 통과가 필요한 테스트는 이 값(대소문자 변형 포함)을 쓴다.
process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL = "demo-admin@example.com";

// jsdom 에 미구현 — element.scrollIntoView 호출 테스트용
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
