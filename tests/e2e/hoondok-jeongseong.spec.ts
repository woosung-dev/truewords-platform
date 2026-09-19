import { expect, type Page, test } from "@playwright/test";

// 훈독 정성 기간 (PLAN-HD-002 W1-J · SCR-PWA-004 시트 + SCR-PWA-002 홈 카드).
// 시드 사용자는 이미 정성이 있을 수 있어(409) 매 실행 새 계정을 만든다.

// 비로그인 방문의 `GET /hoondok/auth/me` 401 은 계약이다(API-HD-003) — hoondok.spec.ts 와 같은 한 건만 제외한다.
const EXPECTED_401 = /status of 401/;
function isAnonymousAuthProbe(text: string, url: string) {
  return EXPECTED_401.test(text) && url.includes("/hoondok/auth/me");
}

async function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isAnonymousAuthProbe(message.text(), message.location().url)) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** 새 계정으로 가입해 홈으로 돌아온다 (hoondok.spec.ts 의 가입 흐름). */
async function signUp(page: Page, name: string) {
  await page.goto("/hoondok/onboarding");
  await page.getByLabel(/이름/).fill(name);
  await page.getByLabel(/이메일/).fill(`e2e-jeongseong-${Date.now()}@example.com`);
  await page.getByLabel(/비밀번호/).fill("password1");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText(`${name}님`)).toBeVisible();
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("정성 시트에서 21일 정성을 만들면 홈 카드가 D-20 으로 바뀐다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "정성");

  // 정성이 없으면 홈은 시트로 보내는 CTA 만 둔다
  await expect(page.getByRole("link", { name: "정성 시작하기" })).toBeVisible();
  await page.getByRole("link", { name: "정성 시작하기" }).click();
  await expect(page).toHaveURL(/\/hoondok\?sheet=jeongseong$/);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "정성 기간 만들기" })).toBeVisible();
  // 가족 챌린지 토글은 W3 범위라 이 시트에 없다
  await expect(dialog.getByText(/가족 챌린지/)).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.locator(".js-opt").filter({ hasText: "세 주" }).click();
  await expect(page.locator(".js-opt[data-on]")).toContainText("21");
  await page.getByRole("button", { name: "감사" }).click();
  await page.getByRole("button", { name: "정성 시작하기" }).click();

  // 성공하면 URL 에서 sheet 가 빠지고 홈 카드가 진행 상태로 바뀐다 (오늘 시작 → 21일 중 남은 20일)
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText("21일 새벽 정성 · 감사")).toBeVisible();
  await expect(page.getByText("D-20")).toBeVisible();
  await expect(page.getByText("매일 오전 5:30")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "정성 진행률" })).toBeVisible();

  // 사용자당 active 1건 (API-HD-009) — 같은 계정의 재요청은 409
  const again = await page.request.post("/api/backend/hoondok/me/jeongseong", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
    data: { topic: "감사", duration_days: 21 },
  });
  expect(again.status()).toBe(409);

  // ≥1024px 은 중앙 모달 520px (DES-PWA-003 §2.7)
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hoondok?sheet=jeongseong");
  const panel = page.locator(".sheet__panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width).toBeGreaterThan(500);
  expect(box?.width).toBeLessThan(540);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // 닫기 = URL 에서 sheet 를 지우는 것 하나. Esc·백드롭도 <dialog> 의 close 이벤트로 같은 경로를 탄다.
  await page.getByRole("button", { name: "닫기" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  expect(errors).toEqual([]);
});
