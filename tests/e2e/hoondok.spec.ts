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

test("비로그인 완료 → 온보딩 가입 → 당일 소급 → 홈 연속 1일", async ({ page }) => {
  await page.goto("/hoondok");
  // 데스크톱 홈은 앱바 h1 을 sr-only 로 접으므로 존재만 확인하고, 보이는 제목은 섹션 h2 로 본다.
  await expect(page.getByRole("heading", { name: "오늘 훈독" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "오늘 말씀" })).toBeVisible();
  // make e2e 시드(scripts/seed_daily_readings.py)가 오늘 날짜를 채운다. 시드 데이터는 권리 확인 중(R)·미검수다.
  const card = page.getByRole("article").first();
  await expect(card).toBeVisible();
  await expect(card.getByText("권리 확인 중")).toBeVisible();
  await expect(card.getByText("확인되지 않음")).toBeVisible();
  await expect(page.getByRole("link", { name: /로그인 후 기록돼요/ })).toBeVisible();
  await page.getByRole("link", { name: /훈독하기/ }).click();
  await expect(page).toHaveURL(/\/hoondok\/read$/);
  // 훈독하기: 출처 줄(화자·저작물) + 전문 + 완료 버튼 → 비로그인이라 로컬 완료 + 로그인 링크
  await expect(page.locator(".src").first()).toContainText("참");
  await expect(page.locator(".scripture")).toBeVisible();
  await page.getByRole("button", { name: "훈독 완료" }).click();
  await expect(page.getByRole("status")).toContainText("오늘 훈독을 마쳤어요");
  await page.getByRole("link", { name: /로그인하면 오늘 기록이 남아요/ }).click();
  await expect(page).toHaveURL(/\/hoondok\/onboarding\?returnTo=%2Fhoondok%2Fread$/);

  // 온보딩 최소형: 베타 고지 · 교회 선택 없음 · 가입
  await expect(page.getByText(/독립 운영 베타/).first()).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  const email = `e2e-${Date.now()}@example.com`;
  await page.getByLabel(/이름/).fill("이투이");
  await page.getByLabel(/이메일/).fill(email);
  await page.getByLabel(/비밀번호/).fill("password1");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();

  // returnTo 로 복귀 → 로컬 체크가 당일분으로 소급 기록되고 로그인 링크는 사라진다
  await expect(page).toHaveURL(/\/hoondok\/read$/);
  await expect(page.getByRole("status")).toContainText("오늘 훈독을 마쳤어요");
  await expect(page.getByRole("link", { name: /로그인하면 오늘 기록이 남아요/ })).toHaveCount(0);
  await page.getByRole("link", { name: "뒤로" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText("이투이님")).toBeVisible();
  await expect(page.locator(".week__streak")).toContainText("연속 1일");
  await expect(page.locator(".week__day[data-today][data-done]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /훈독하기.*완료/ })).toHaveAttribute("aria-pressed", "true");

  // 같은 날 재요청은 409 — 화면은 완료 유지, 요약은 그대로 1회
  const again = await page.request.post("/api/backend/hoondok/missions/read/complete", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  expect(again.status()).toBe(409);
});

test("시드 사용자 로그인 → 훈독 완료 → 로그아웃 → 완료 API 401", async ({ page }) => {
  await page.goto("/hoondok/onboarding");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByLabel(/이메일/).fill("hoondok@example.com");
  await page.getByLabel(/비밀번호/).fill("test1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText("시드식구님")).toBeVisible();

  const summaryBefore = await (await page.request.get("/api/backend/hoondok/me/summary")).json();
  const done = await page.request.post("/api/backend/hoondok/missions/read/complete", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  // 시드 사용자는 다른 테스트·재실행이 이미 완료했을 수 있다 — 201 또는 409 모두 "오늘 1회" 다
  expect([201, 409]).toContain(done.status());
  const summaryAfter = await (await page.request.get("/api/backend/hoondok/me/summary")).json();
  expect(summaryAfter.today.read).toBe(true);
  expect(summaryAfter.streak_days).toBeGreaterThanOrEqual(1);
  expect(summaryAfter.total_days).toBe(Math.max(summaryBefore.total_days, 1));

  // 로그아웃 → 완료·요약 API 는 401, 홈은 여전히 비로그인 열람
  await page.goto("/hoondok/onboarding");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("form", { name: "가입" })).toBeVisible();
  expect((await page.request.get("/api/backend/hoondok/me/summary")).status()).toBe(401);
  expect(
    (
      await page.request.post("/api/backend/hoondok/missions/read/complete", {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
    ).status(),
  ).toBe(401);
  await page.goto("/hoondok");
  await expect(page.getByRole("heading", { name: "오늘 말씀" })).toBeVisible();
});
