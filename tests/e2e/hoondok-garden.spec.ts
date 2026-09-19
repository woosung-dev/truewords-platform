import { expect, type Page, test } from "@playwright/test";

// SCR-PWA-014 나의 정원 (PLAN-HD-002 W1-G). 시드 사용자로 오늘 훈독을 기록한 뒤 통계·달력·탭을 본다.
// 플래그 ON 은 playwright.config webServer env 가 준다.
const SEED = { email: "hoondok@example.com", password: "test1234" } as const;

// 비로그인 방문의 `GET /hoondok/auth/me` 401 은 계약이다(API-HD-003) — hoondok.spec.ts 와 같은 필터를 쓴다.
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

async function login(page: Page) {
  await page.goto("/hoondok/onboarding");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByLabel(/이메일/).fill(SEED.email);
  await page.getByLabel(/비밀번호/).fill(SEED.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("로그인 → 오늘 완료 → 정원: 통계·달력 오늘 칸·정원 탭 활성 · 390/1280 넘침 0 · 콘솔 오류 0", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await login(page);

  // 시드 사용자는 재실행 시 이미 완료(409)일 수 있다 — 둘 다 "오늘 1회" 다
  const done = await page.request.post("/api/backend/hoondok/missions/read/complete", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  expect([201, 409]).toContain(done.status());

  await page.goto("/hoondok/garden");
  await expect(page.getByRole("heading", { name: "나의 정원", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "말씀과 함께한 시간" })).toBeVisible();

  // 오늘 칸은 완료 + 오늘 두 표시를 함께 갖고, 완료는 체크 아이콘이 1차 신호다 (DES §3.3)
  const todayCell = page.locator(".gd-cal__day[data-today][data-done]");
  await expect(todayCell).toHaveCount(1);
  await expect(todayCell.locator(".gd-cal__dot--done svg")).toHaveCount(1);
  await expect(todayCell).toHaveAttribute("aria-label", /오늘 완료$/);

  // 연속일 ≥ 1 (오늘 완료를 방금 기록했다)
  const streak = await page.locator(".stats__n--accent").innerText();
  expect(Number(streak.replace(/\D/g, ""))).toBeGreaterThanOrEqual(1);

  await expect(page.getByRole("link", { name: /나의 정원/ })).toHaveAttribute("aria-current", "page");

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".gd-cal__grid")).toBeVisible();
    expect(await overflow(page), `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
  }

  expect(errors).toEqual([]);
});

test("비로그인 정원: 온보딩 안내만 보이고 기록·정성을 그리지 않는다", async ({ page }) => {
  await page.goto("/hoondok/garden");
  await expect(page.getByRole("heading", { name: /로그인하면 훈독 기록과 정성을/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "시작하기" })).toHaveAttribute(
    "href",
    "/hoondok/onboarding?returnTo=%2Fhoondok%2Fgarden",
  );
  await expect(page.locator(".gd-cal__grid")).toHaveCount(0);
  await expect(page.locator(".stats")).toHaveCount(0);
  // 읽기 화면은 열어 두고 행동에서만 온보딩으로 보낸다 — 자동 리다이렉트가 없어야 한다
  await expect(page).toHaveURL(/\/hoondok\/garden$/);
});
