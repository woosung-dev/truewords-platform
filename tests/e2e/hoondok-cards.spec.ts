import { type BrowserContext, expect, type Page, test } from "@playwright/test";

// 오늘의 책갈피 (PLAN-HD-012, SCR-PWA-022~026). 시드 seed_hoondok_journey.py 의 active 카드 3장 중 오늘 회전 카드를 쓴다.
// 플래그 NEXT_PUBLIC_HOONDOK_CARDS=1 은 playwright.config webServer env 가 준다. 계정은 매번 새로 만든다(재실행 안전).
const headers = { "X-Requested-With": "XMLHttpRequest" };

type TodayCard = {
  id: string;
  text: string;
  volume: string;
  chunk_id: string;
  work_title: string;
  source_label: string;
};

async function todayCard(page: Page): Promise<TodayCard> {
  const response = await page.request.get("/api/backend/hoondok/cards/today");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.card).not.toBeNull();
  return body.card;
}

async function signUp(page: Page) {
  const response = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers,
    data: { email: `cards-${Date.now()}@example.com`, password: "password1", display_name: "책갈피" },
  });
  expect(response.status()).toBe(201);
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function grantClipboard(context: BrowserContext, origin: string) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
}

test("홈 카드 → 받기 → 읽기 → 건네기 시트 → 원문 밑줄 → 다시 꺼내기 (비로그인)", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const card = await todayCard(page);

  await page.goto("/hoondok");
  const home = page.locator(".bmhome");
  await expect(page.getByRole("heading", { name: "오늘의 책갈피" })).toBeVisible();
  await expect(home).toContainText(card.volume);
  await home.getByRole("link", { name: "책갈피 꺼내기" }).click();

  await expect(page).toHaveURL(/\/hoondok\/bookmark$/);
  const reinsert = page.getByRole("button", { name: /책에 다시 꽂기/ });
  await expect(reinsert).toBeEnabled();
  await expect(page.locator(".bmk-card")).toContainText(card.text);
  await expect(page.locator(".bmk-card")).toContainText(card.source_label);
  expect(await page.evaluate(() => window.localStorage.getItem("hoondok:card:received"))).toContain(card.id);
  expect(await overflow(page)).toBe(0);

  // 건네기 시트: 1:1 이미지 미리보기 + 네 갈래 + 출처 고정 안내
  await grantClipboard(page.context(), baseURL ?? "");
  await page.getByRole("button", { name: "건네기" }).click();
  const sheet = page.getByRole("dialog", { name: "건네기" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("img", { name: /건넬 책갈피 카드/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /카카오톡·다른 앱으로 보내기/ })).toBeVisible();
  await expect(sheet.getByRole("link", { name: /스토리·상태 사진 저장/ })).toHaveAttribute("href", /f=story/);
  await expect(sheet.getByRole("link", { name: /사진 저장 1:1/ })).toHaveAttribute("href", /f=square/);
  await expect(sheet).toContainText("훈독 표시는 카드에 늘 함께 가요");
  await sheet.getByRole("button", { name: "글로 복사" }).click();
  await expect(page.locator(".bmk-toast")).toContainText("복사했어요");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/hoondok/c/${card.id}`);
  await sheet.getByRole("button", { name: "닫기" }).click();

  // 책에 다시 꽂기 → 서고 원문: 인용 단락 안 문장 밑줄 + 여백 리본
  await reinsert.click();
  await expect(page).toHaveURL(new RegExp(`card=${card.id}`));
  await expect(page.getByText("오늘의 책갈피가 꽂힌 자리예요.")).toBeVisible();
  await expect(page.locator(".verse--card .wd-card-ul")).toContainText(card.text.slice(0, 10));
  await expect(page.locator(".verse--card .wd-card-rib")).toBeVisible();
  expect(await overflow(page)).toBe(0);

  // 책갈피 다시 꺼내기 → 오늘 이미 받았으므로 모션 없이 읽기
  await page.getByRole("button", { name: "책갈피 다시 꺼내기" }).click();
  await expect(page).toHaveURL(/\/hoondok\/bookmark\?from=words$/);
  await expect(page.locator(".bmk--read")).toBeVisible();
  await expect(page.locator(".bmk-moment")).toBeHidden();
});

test("받은 사람 화면은 로그인 없이 열리고 OG 는 2:1 이미지를 가리킨다", async ({ page, request }) => {
  const card = await todayCard(page);
  await page.goto(`/hoondok/c/${card.id}`);
  await expect(page.locator(".rcv .bm")).toContainText(card.text);
  const original = page.getByRole("link", { name: "원문에서 앞뒤 읽기" });
  await expect(original).toHaveAttribute("href", new RegExp(`chunk_id=.*&card=${card.id}`));
  await expect(page.getByRole("link", { name: "훈독에서 매일 한 장 받기" })).toHaveAttribute("href", "/hoondok");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    `오늘의 책갈피 · ${card.work_title}`,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/hoondok\/c\/.+\/image\?f=link$/,
  );

  for (const format of ["link", "square", "story"]) {
    const image = await request.get(`/hoondok/c/${card.id}/image?f=${format}`);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
  }
  expect((await request.get("/hoondok/c/00000000-0000-4000-8000-000000000000")).status()).toBe(404);

  await original.click();
  await expect(page.locator(".verse--card .wd-card-ul")).toBeVisible();
  // 오늘 카드이므로 "다시 꺼내기" 가 보인다
  await expect(page.getByRole("button", { name: "책갈피 다시 꺼내기" })).toBeVisible();
});

test("비로그인으로 받은 뒤 가입하면 당일분이 나의 책갈피에 소급되고, 건넴이 남는다", async ({ page, baseURL }) => {
  const card = await todayCard(page);
  await page.goto("/hoondok/bookmarks");
  await expect(page.getByRole("heading", { name: "로그인하면 받은 책갈피가 모여요" })).toBeVisible();

  await page.goto("/hoondok/bookmark");
  await expect(page.getByRole("button", { name: /책에 다시 꽂기/ })).toBeEnabled();
  await signUp(page);

  // 가입 뒤 어느 책갈피 화면이든 열면 익명 기록을 receive 로 소급한다
  await page.goto("/hoondok/bookmarks");
  await expect(page.getByRole("tab", { name: "받은 책갈피" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".bks-spine")).toHaveCount(1);
  await expect(page.locator(".bks-spine")).toContainText(card.work_title);
  await expect(page.locator(".bks-item")).toContainText(card.text);

  // 건네기(클립보드 폴백) → 건넨 책갈피 탭
  await grantClipboard(page.context(), baseURL ?? "");
  await page.goto("/hoondok/bookmark");
  await page.getByRole("button", { name: "건네기" }).click();
  await page.getByRole("dialog", { name: "건네기" }).getByRole("button", { name: "글로 복사" }).click();
  await expect(page.locator(".bmk-toast")).toContainText("복사했어요");
  await expect
    .poll(
      async () => (await (await page.request.get("/api/backend/hoondok/me/cards?filter=shared")).json()).items.length,
    )
    .toBe(1);
  await page.goto("/hoondok/bookmarks?filter=shared");
  await expect(page.getByRole("tab", { name: "건넨 책갈피" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".bks-item")).toContainText(card.text);

  // 나의 정원 진입 링크
  await page.goto("/hoondok/garden");
  await page.getByRole("link", { name: /나의 책갈피/ }).click();
  await expect(page).toHaveURL(/\/hoondok\/bookmarks$/);
});
