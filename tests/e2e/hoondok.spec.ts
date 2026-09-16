import { expect, type Page, test } from "@playwright/test";

// 훈독 Phase 1 스모크 (PLAN-HD-001 §4 sub-PR 1). 플래그 ON 은 playwright.config webServer env 가 준다.
const PATHS = ["/hoondok", "/hoondok/read"] as const;
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

async function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

for (const viewport of VIEWPORTS) {
  for (const path of PATHS) {
    test(`${viewport.name} ${path}: 가로 넘침 0 · 콘솔 오류 0 · noindex`, async ({ page }) => {
      const errors = await collectConsoleErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["x-robots-tag"]).toContain("noindex");
      await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
}

test("훈독 스코프 토큰은 시연 챗 :root --accent 를 바꾸지 않는다", async ({ page }) => {
  await page.goto("/hoondok");
  const scoped = await page.evaluate(() =>
    getComputedStyle(document.querySelector('[data-app="hoondok"]')!).getPropertyValue("--accent").trim(),
  );
  expect(scoped).toBe("#c24721");
  const rootOnHoondok = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  expect(rootOnHoondok).not.toBe("#c24721");

  await page.goto("/design-system");
  const rootOnDesignSystem = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  expect(rootOnDesignSystem).toBe(rootOnHoondok);
  expect(rootOnDesignSystem).toMatch(/oklch\(0\.539 0\.166 47\)|lab\(/);
});

test("홈 → 훈독하기 → 완료 (로컬 상태) → 뒤로", async ({ page }) => {
  await page.goto("/hoondok");
  // 데스크톱 홈은 앱바 h1 을 sr-only 로 접으므로 존재만 확인하고, 보이는 제목은 섹션 h2 로 본다.
  await expect(page.getByRole("heading", { name: "오늘 훈독" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "오늘 말씀" })).toBeVisible();
  // make e2e 시드(scripts/seed_daily_readings.py)가 오늘 날짜를 채운다. 시드 데이터는 권리 확인 중(R)·미검수다.
  const card = page.getByRole("article").first();
  await expect(card).toBeVisible();
  await expect(card.getByText("권리 확인 중")).toBeVisible();
  await expect(card.getByText("확인되지 않음")).toBeVisible();
  await page.getByRole("link", { name: /훈독하기/ }).click();
  await expect(page).toHaveURL(/\/hoondok\/read$/);
  // 훈독하기: 출처 줄(화자·저작물) + 전문 + 완료 버튼 → 로컬 완료 상태
  await expect(page.locator(".src").first()).toContainText("참");
  await expect(page.locator(".scripture")).toBeVisible();
  await page.getByRole("button", { name: "훈독 완료" }).click();
  await expect(page.getByRole("status")).toContainText("오늘 훈독을 마쳤어요");
  await page.getByRole("link", { name: "뒤로" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
});
