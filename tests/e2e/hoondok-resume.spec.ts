import type { Page } from "@playwright/test";
import { expect, test } from "./hoondok-test";

// 홈 "말씀 읽기 · 이어 읽기" 카드 → 원문 도착 라벨 (A1). 합성 코퍼스(apps/api/scripts/seed_hoondok_journey.py):
// "말씀선집 355권" 25단락, 장 목차 = 제1편(0~19) · 1장(0~19) · 제2편(20~24). 원장 work_title 은 volume 과 같다.
const volume = "말씀선집 355권";
const wordsPath = `/hoondok/words/${encodeURIComponent(volume)}`;
const headers = { "X-Requested-With": "XMLHttpRequest" };

function resumeCard(page: Page) {
  return page.locator(".mission").filter({ hasText: "말씀 읽기 · 이어 읽기" });
}

test("로그인: 원문 2구간을 열면 홈 카드가 그 자리를 보이고 누르면 21단락 앞에 도착한다", async ({ page }) => {
  const signup = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers,
    data: { email: `resume-${Date.now()}@example.com`, password: "password1", display_name: "이어" },
  });
  expect(signup.status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });

  const saved = page.waitForResponse(
    (response) => response.url().includes("/hoondok/me/reading-position/") && response.request().method() === "PUT",
  );
  await page.goto(`${wordsPath}?page=2`);
  await expect(page.getByRole("article", { name: "원문 본문" })).toContainText("21번째 합성 문장");
  expect((await saved).status()).toBe(200);
  // 그냥 연 원문에는 도착 라벨이 없다
  await expect(page.getByText("여기서부터 이어 읽어요")).toHaveCount(0);

  await page.goto("/hoondok");
  const card = resumeCard(page);
  await expect(card.locator(".mission__title")).toHaveText(`${volume} · 제2편 참사랑의 실천`);
  await expect(card.locator(".mission__meta")).toHaveText("21단락부터 이어 읽어요 · 오늘");
  await card.getByRole("link").click();

  await expect(page).toHaveURL(/\/hoondok\/words\/.+\?page=2&from=resume$/);
  const label = page.getByRole("status").filter({ hasText: "여기서부터 이어 읽어요" });
  await expect(label).toBeVisible();
  await expect(label).toBeInViewport();
  // 카드의 N 과 원문이 보여 주는 단락 번호가 같다
  const arrival = page.locator("p.verse--arrive");
  await expect(arrival).toHaveCount(1);
  await expect(arrival.getByRole("button", { name: "단락 21 표시하기" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
    0,
  );
});

test("비로그인: 이 기기에서 읽던 곳을 보이고 동작 줄이기에서는 번짐 없이 라벨만 남는다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(wordsPath);
  await expect(page.getByRole("article", { name: "원문 본문" })).toContainText("1번째 합성 문장");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("hoondok:read:last")))
    .toBe(JSON.stringify({ volume, page: 1 }));

  await page.goto("/hoondok");
  const card = resumeCard(page);
  await expect(card.locator(".mission__title")).toHaveText(`${volume} · 1장 이웃을 듣는 마음`);
  await expect(card.locator(".mission__meta")).toHaveText("1단락부터 이어 읽어요 · 이 기기에서 읽던 곳");
  await card.getByRole("link").click();

  await expect(page).toHaveURL(/\/hoondok\/words\/.+\?page=1&from=resume$/);
  await expect(page.getByRole("status").filter({ hasText: "여기서부터 이어 읽어요" })).toBeVisible();
  const arrival = page.locator("p.verse--arrive");
  await expect(arrival.getByRole("button", { name: "단락 1 표시하기" })).toBeVisible();
  expect(await arrival.evaluate((element) => getComputedStyle(element, "::after").animationName)).toBe("none");
});

test("기록이 없으면 홈 카드는 서고 안내 그대로다", async ({ page }) => {
  await page.goto("/hoondok");
  const card = resumeCard(page);
  await expect(card.locator(".mission__title")).toHaveText("말씀 서고");
  await expect(card.getByRole("link")).toHaveAttribute("href", "/hoondok/library");
});
