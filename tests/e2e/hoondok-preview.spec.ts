import { expect, type Page, test } from "@playwright/test";

// 훈독 정적 프리뷰 셸 (PLAN-HD-002 W3 · SCR-PWA-007·008·009·010~013·016).
// 세 에이전트가 만든 화면을 오케스트레이터가 한 spec 에 등록한다(§4 W3 완료 기준).
// 플래그 두 개(ENABLED·PREVIEW)는 playwright.config 의 webServer env 가 준다 — OFF 의 notFound 는 Vitest 가 본다.
// 이 화면들은 fixture 만 그리므로 백엔드를 타지 않는다. "네트워크 0" 을 여기서 실제로 단언한다.

const PREVIEW_PATHS = [
  "/hoondok/library",
  "/hoondok/search",
  "/hoondok/words/cheonseonggyeong-1-3",
  "/hoondok/worship",
  "/hoondok/worship/challenge/family-21",
  "/hoondok/worship/sermons",
  "/hoondok/worship/request",
  "/hoondok/family",
] as const;

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

const PREVIEW_NOTICE = "미리보기 예시 데이터입니다";

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

/** 프리뷰 화면이 보낸 백엔드 요청. 셸은 fixture 만 그리므로 항상 비어 있어야 한다. */
async function collectApiRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/backend/")) urls.push(request.url());
  });
  return urls;
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const viewport of VIEWPORTS) {
  for (const path of PREVIEW_PATHS) {
    test(`${viewport.name} ${path}: 200 · 넘침 0 · 콘솔 0 · noindex · 미리보기 안내`, async ({ page }) => {
      const errors = await collectConsoleErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["x-robots-tag"]).toContain("noindex");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator("main").getByText(PREVIEW_NOTICE).first()).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
}

test("fixture 에 없는 id 는 404 다", async ({ page }) => {
  for (const path of ["/hoondok/words/nope", "/hoondok/worship/challenge/nope"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("프리뷰 ON: 탭 5개가 모두 이동한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hoondok/library");
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  for (const label of ["오늘 훈독", "AI 질문", "말씀", "가정예배", "나의 정원"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
});

test("검색 제출: 네트워크 0 · 준비 중 안내 · 최근 검색이 기기에 남는다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  const apiRequests = await collectApiRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hoondok/search");

  await page.getByRole("textbox").first().fill("참사랑");
  await page.getByRole("button", { name: /찾기|검색/ }).click();
  await expect(page.getByRole("status")).toContainText("준비 중");
  expect(apiRequests).toEqual([]);

  await page.reload();
  await expect(page.getByText("참사랑").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("설교 섭외 제출: 이동 없이 준비 중 안내 · 네트워크 0", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  const apiRequests = await collectApiRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hoondok/worship/request");

  // 필수 필드는 전부 기본값이 있어 그대로 제출된다 — 폼이 실제로 아무 데도 보내지 않는지만 본다.
  await page.getByRole("button", { name: /요청 보내기/ }).click();
  await expect(page.getByRole("status")).toContainText("준비 중");
  await expect(page).toHaveURL(/\/hoondok\/worship\/request$/);
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("가족·친구: 초대 버튼은 안내만 내고 네트워크를 타지 않는다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  const apiRequests = await collectApiRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hoondok/family");

  await page.getByRole("button", { name: /초대/ }).first().click();
  await expect(page.getByRole("status")).toContainText("준비 중");
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});
